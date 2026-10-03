import { existsSync, promises } from 'fs';
import bitcoinClient from '../../../api/bitcoin/bitcoin-client';
import { Common } from '../../../api/common';
import config from '../../../config';
import logger from '../../../logger';

const fsPromises = promises;

const BLOCKS_CACHE_MAX_SIZE = 100;
const CACHE_FILE_NAME = config.MEMPOOL.CACHE_DIR + '/ln-funding-txs-cache.json';

class FundingTxFetcher {
  private running = false;
  private blocksCache = {};
  private channelNewlyProcessed = 0;
  public fundingTxCache = {};

  async $init(): Promise<void> {
    // Load funding tx disk cache
    if (Object.keys(this.fundingTxCache).length === 0 && existsSync(CACHE_FILE_NAME)) {
      try {
        this.fundingTxCache = JSON.parse(await fsPromises.readFile(CACHE_FILE_NAME, 'utf-8'));
      } catch (e) {
        logger.err(`Unable to parse channels funding txs disk cache. Starting from scratch`, logger.tags.ln);
        this.fundingTxCache = {};
      }
      logger.debug(`Imported ${Object.keys(this.fundingTxCache).length} funding tx amount from the disk cache`, logger.tags.ln);
    }
  }

  /** @asyncUnsafe */
  async $fetchChannelsFundingTxs(channelIds: string[], known: Record<string, KnownFunding> = {}): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;

    const globalTimer = new Date().getTime() / 1000;
    let cacheTimer = new Date().getTime() / 1000;
    let loggerTimer = new Date().getTime() / 1000;
    let channelProcessed = 0;
    this.channelNewlyProcessed = 0;
    for (const channelId of channelIds) {
      await this.$fetchChannelOpenTx(channelId, known[channelId]);
      ++channelProcessed;

      let elapsedSeconds = Math.round((new Date().getTime() / 1000) - loggerTimer);
      if (elapsedSeconds > config.LIGHTNING.LOGGER_UPDATE_INTERVAL) {
        elapsedSeconds = Math.round((new Date().getTime() / 1000) - globalTimer);
        logger.info(`Indexing channels funding tx ${channelProcessed + 1} of ${channelIds.length} ` +
          `(${Math.floor(channelProcessed / channelIds.length * 10000) / 100}%) | ` +
          `elapsed: ${elapsedSeconds} seconds`,
          logger.tags.ln
        );
        loggerTimer = new Date().getTime() / 1000;
      }

      elapsedSeconds = Math.round((new Date().getTime() / 1000) - cacheTimer);
      if (elapsedSeconds > 60) {
        logger.debug(`Saving ${Object.keys(this.fundingTxCache).length} funding txs cache into disk`, logger.tags.ln);
        fsPromises.writeFile(CACHE_FILE_NAME, JSON.stringify(this.fundingTxCache)).catch((e) => {
          logger.err(`Error saving funding txs cache to disk: ${e instanceof Error ? e.message : e}`, logger.tags.ln);
        });
        cacheTimer = new Date().getTime() / 1000;
      }
    }

    if (this.channelNewlyProcessed > 0) {
      logger.info(`Indexed ${this.channelNewlyProcessed} additional channels funding tx`, logger.tags.ln);
      logger.debug(`Saving ${Object.keys(this.fundingTxCache).length} funding txs cache into disk`, logger.tags.ln);
      fsPromises.writeFile(CACHE_FILE_NAME, JSON.stringify(this.fundingTxCache)).catch((e) => {
        logger.err(`Error saving funding txs cache to disk: ${e instanceof Error ? e.message : e}`, logger.tags.ln);
      });
    }

    this.running = false;
  }

  /**
   * The funding transaction of a channel: its txid, the funding output's
   * value in BTC, and the time of the block it confirmed in.
   *
   * Upstream reads the whole block and then the transaction by txid, which
   * needs `txindex` and the block itself. A pruned node has no `txindex`,
   * and a block old enough is gone, so neither works there. What the caller
   * already knows from the Lightning node (the funding outpoint and the
   * capacity, which is that output's value) is used instead when given, and
   * the date comes from the block header, which a pruned node always keeps.
   * Otherwise the block is read with its transactions (verbosity 2, no
   * `txindex`), which works while the node still has it.
   *
   * @asyncUnsafe
   */
  public async $fetchChannelOpenTx(channelId: string, known?: KnownFunding): Promise<{timestamp: number, txid: string, value: number} | null> {
    channelId = Common.channelIntegerIdToShortId(channelId);

    if (!channelId?.length) {
      return null;
    }

    if (this.fundingTxCache[channelId]) {
      return this.fundingTxCache[channelId];
    }

    const parts = channelId?.split('x') ?? [];
    if (parts.length < 3) {
      logger.debug(`Channel ID ${channelId} does not seem valid, should contains at least 3 parts separated by 'x'`, logger.tags.ln);
      return null;
    }
    const blockHeight = parseInt(parts[0], 10);
    const txIdx = parseInt(parts[1], 10);
    const outputIdx = parseInt(parts[2], 10);

    let blockHash: string;
    try {
      blockHash = await bitcoinClient.getBlockHash(blockHeight);
    } catch (e) {
      logger.debug(`Cannot find block ${blockHeight} for channel ${channelId}: ${e instanceof Error ? e.message : e}`, logger.tags.ln);
      return null;
    }

    let funding: {timestamp: number, txid: string, value: number} | null = null;

    const knownValue = known?.value ?? 0;
    const knownTxid = known?.txid ?? '';
    if (knownValue > 0 && knownTxid.length === 64) {
      try {
        const header = await bitcoinClient.getBlockHeader(blockHash, true);
        funding = { timestamp: header.time, txid: knownTxid, value: knownValue };
      } catch (e) {
        logger.debug(`Cannot read the header of block ${blockHeight} for channel ${channelId}: ${e instanceof Error ? e.message : e}`, logger.tags.ln);
        return null;
      }
    } else {
      let block = this.blocksCache[blockHeight];
      if (!block) {
        try {
          block = await bitcoinClient.getBlock(blockHash, 2);
        } catch (e) {
          // Pruned, most likely: without what the Lightning node knows
          // there is nothing more to read.
          logger.debug(`Cannot read block ${blockHeight} for channel ${channelId} funding tx: ${e instanceof Error ? e.message : e}`, logger.tags.ln);
          return null;
        }
        this.blocksCache[blockHeight] = block;
        const heights = Object.keys(this.blocksCache).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
        if (heights.length > BLOCKS_CACHE_MAX_SIZE) {
          for (let i = 0; i < 10; ++i) {
            delete this.blocksCache[heights[i]];
          }
        }
      }
      const tx = block.tx?.[txIdx];
      if (!tx || !tx.vout || tx.vout.length < outputIdx + 1 || tx.vout[outputIdx].value === undefined) {
        logger.err(`Cannot find blockchain funding tx for channel id ${channelId}. Possible reasons are: bitcoin backend timeout or the channel shortId is not valid`);
        return null;
      }
      funding = { timestamp: block.time, txid: tx.txid, value: tx.vout[outputIdx].value };
    }

    this.fundingTxCache[channelId] = funding;
    ++this.channelNewlyProcessed;

    return funding;
  }
}

/**
 * What the Lightning node says about a channel's funding: the funding
 * transaction's id and the capacity in BTC (the funding output's value).
 */
export interface KnownFunding {
  txid?: string;
  value?: number;
}

/** The funding txid of a `txid:vout` channel point, or ''. */
export function txidOfChanPoint(chanPoint?: string): string {
  const txid = (chanPoint ?? '').split(':')[0];
  return /^[0-9a-f]{64}$/i.test(txid) ? txid : '';
}

export default new FundingTxFetcher;
