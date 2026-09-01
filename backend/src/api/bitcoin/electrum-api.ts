import config from '../../config';
import Client from '@mempool/electrum-client';
import { AbstractBitcoinApi } from './bitcoin-api-abstract-factory';
import { IEsploraApi } from './esplora-api.interface';
import { IElectrumApi } from './electrum-api.interface';
import BitcoinApi from './bitcoin-api';
import { IBitcoinApi } from './bitcoin-api.interface';
import mempool from '../mempool';
import logger from '../../logger';
import crypto from 'crypto-js';
import loadingIndicators from '../loading-indicators';
import memoryCache from '../memory-cache';

class BitcoindElectrsApi extends BitcoinApi implements AbstractBitcoinApi {
  // How many transactions to ask for in one batched Electrum request. Small
  // enough that the buffered response stays in the hundreds of kilobytes on a
  // block of ordinary transactions, large enough that a full block is tens of
  // round trips rather than thousands.
  private static readonly TRANSACTION_BATCH_SIZE = 100;

  private electrumClient: any;

  constructor(bitcoinClient: any) {
    super(bitcoinClient);

    // A range, not a single version. The protocol takes [min, max] here and the
    // server picks its own version within it, so this is what lets one build
    // reach both an ordinary chain and one carrying BLAKE2b headers: a server on
    // the latter refuses to negotiate below 1.8, and a server on the former
    // still answers 1.4. Sending a bare '1.4', as upstream does, is refused
    // outright by a BLAKE2b server with a message saying why.
    //
    // Safe to widen because none of the Electrum methods this class uses change
    // shape across the range. blockchain.block.headers does change at 1.6, from
    // a concatenated string to a list, but nothing here calls it.
    const electrumConfig = { client: 'mempool-v2', version: ['1.4', '1.8'] };
    const electrumPersistencePolicy = { retryPeriod: 1000, maxRetry: Number.MAX_SAFE_INTEGER, callback: null };

    const electrumCallbacks = {
      onConnect: (client, versionInfo) => { logger.info(`Connected to Electrum Server at ${config.ELECTRUM.HOST}:${config.ELECTRUM.PORT} (${JSON.stringify(versionInfo)})`); },
      onClose: (client) => { logger.info(`Disconnected from Electrum Server at ${config.ELECTRUM.HOST}:${config.ELECTRUM.PORT}`); },
      onError: (err) => { logger.err(`Electrum error: ${JSON.stringify(err)}`); },
      onLog: (str) => { logger.debug(str); },
    };

    this.electrumClient = new Client(
      config.ELECTRUM.PORT,
      config.ELECTRUM.HOST,
      config.ELECTRUM.TLS_ENABLED ? 'tls' : 'tcp',
      null,
      electrumCallbacks
    );

    this.electrumClient.initElectrum(electrumConfig, electrumPersistencePolicy)
      .then(() => { })
      .catch((err) => {
        logger.err(`Error connecting to Electrum Server at ${config.ELECTRUM.HOST}:${config.ELECTRUM.PORT}`);
      });
  }

  /** @asyncUnsafe */
  async $getAddress(address: string): Promise<IEsploraApi.Address> {
    const addressInfo = await this.bitcoindClient.validateAddress(address);
    if (!addressInfo || !addressInfo.isvalid) {
      throw new Error('Invalid Bitcoin address');
    }

    try {
      const balance = await this.$getScriptHashBalance(addressInfo.scriptPubKey);
      const history = await this.$getScriptHashHistory(addressInfo.scriptPubKey);

      const unconfirmed = history.filter((h) => h.fee).length;

      return {
        'address': addressInfo.address,
        'chain_stats': {
          'funded_txo_count': 0,
          'funded_txo_sum': balance.confirmed ? balance.confirmed : 0,
          'spent_txo_count': 0,
          'spent_txo_sum': balance.confirmed < 0 ? balance.confirmed : 0,
          'tx_count': history.length - unconfirmed,
        },
        'mempool_stats': {
          'funded_txo_count': 0,
          'funded_txo_sum': balance.unconfirmed > 0 ? balance.unconfirmed : 0,
          'spent_txo_count': 0,
          'spent_txo_sum': balance.unconfirmed < 0 ? -balance.unconfirmed : 0,
          'tx_count': unconfirmed,
        },
        'electrum': true,
      };
    } catch (e: any) {
      throw new Error(typeof e === 'string' ? e : e && e.message || e);
    }
  }

  /** @asyncUnsafe */
  async $getAddressTransactions(address: string, lastSeenTxId: string): Promise<IEsploraApi.Transaction[]> {
    const addressInfo = await this.bitcoindClient.validateAddress(address);
    if (!addressInfo || !addressInfo.isvalid) {
      throw new Error('Invalid Bitcoin address');
    }

    try {
      loadingIndicators.setProgress('address-' + address, 0);

      const transactions: IEsploraApi.Transaction[] = [];
      const history = await this.$getScriptHashHistory(addressInfo.scriptPubKey);
      history.sort((a, b) => (b.height || 9999999) - (a.height || 9999999));

      let startingIndex = 0;
      if (lastSeenTxId) {
        const pos = history.findIndex((historicalTx) => historicalTx.tx_hash === lastSeenTxId);
        if (pos) {
          startingIndex = pos + 1;
        }
      }
      const endIndex = Math.min(startingIndex + 10, history.length);

      for (let i = startingIndex; i < endIndex; i++) {
        const tx = await this.$getRawTransaction(history[i].tx_hash, false, true);
        transactions.push(tx);
        loadingIndicators.setProgress('address-' + address, (i + 1) / endIndex * 100);
      }

      return transactions;
    } catch (e: any) {
      loadingIndicators.setProgress('address-' + address, 100);
      throw new Error(typeof e === 'string' ? e : e && e.message || e);
    }
  }

  async $getScriptHash(scripthash: string): Promise<IEsploraApi.ScriptHash> {
    try {
      const balance = await this.electrumClient.blockchainScripthash_getBalance(scripthash);
      let history = memoryCache.get<IElectrumApi.ScriptHashHistory[]>('Scripthash_getHistory', scripthash);
      if (!history) {
        history = await this.electrumClient.blockchainScripthash_getHistory(scripthash);
        memoryCache.set('Scripthash_getHistory', scripthash, history, 2);
      }

      const unconfirmed = history ? history.filter((h) => h.fee).length : 0;

      return {
        'scripthash': scripthash,
        'chain_stats': {
          'funded_txo_count': 0,
          'funded_txo_sum': balance.confirmed ? balance.confirmed : 0,
          'spent_txo_count': 0,
          'spent_txo_sum': balance.confirmed < 0 ? balance.confirmed : 0,
          'tx_count': (history?.length || 0) - unconfirmed,
        },
        'mempool_stats': {
          'funded_txo_count': 0,
          'funded_txo_sum': balance.unconfirmed > 0 ? balance.unconfirmed : 0,
          'spent_txo_count': 0,
          'spent_txo_sum': balance.unconfirmed < 0 ? -balance.unconfirmed : 0,
          'tx_count': unconfirmed,
        },
        'electrum': true,
      };
    } catch (e: any) {
      throw new Error(typeof e === 'string' ? e : e && e.message || e);
    }
  }

  /** @asyncUnsafe */
  async $getAddressUtxos(address: string): Promise<IEsploraApi.UTXO[]> {
    const addressInfo = await this.bitcoindClient.validateAddress(address);
    if (!addressInfo || !addressInfo.isvalid) {
      throw new Error('Invalid Bitcoin address');
    }
    const scripthash = this.encodeScriptHash(addressInfo.scriptPubKey);
    return this.$getScriptHashUtxos(scripthash);
  }

  async $getScriptHashTransactions(scripthash: string, lastSeenTxId?: string): Promise<IEsploraApi.Transaction[]> {
    try {
      loadingIndicators.setProgress('address-' + scripthash, 0);

      const transactions: IEsploraApi.Transaction[] = [];
      let history = memoryCache.get<IElectrumApi.ScriptHashHistory[]>('Scripthash_getHistory', scripthash);
      if (!history) {
        history = await this.electrumClient.blockchainScripthash_getHistory(scripthash);
        memoryCache.set('Scripthash_getHistory', scripthash, history, 2);
      }
      if (!history) {
        throw new Error('failed to get scripthash history');
      }
      history.sort((a, b) => (b.height || 9999999) - (a.height || 9999999));

      let startingIndex = 0;
      if (lastSeenTxId) {
        const pos = history.findIndex((historicalTx) => historicalTx.tx_hash === lastSeenTxId);
        if (pos) {
          startingIndex = pos + 1;
        }
      }
      const endIndex = Math.min(startingIndex + 10, history.length);

      for (let i = startingIndex; i < endIndex; i++) {
        const tx = await this.$getRawTransaction(history[i].tx_hash, false, true);
        transactions.push(tx);
        loadingIndicators.setProgress('address-' + scripthash, (i + 1) / endIndex * 100);
      }

      return transactions;
    } catch (e: any) {
      loadingIndicators.setProgress('address-' + scripthash, 100);
      throw new Error(typeof e === 'string' ? e : e && e.message || e);
    }
  }

  /** @asyncUnsafe */
  async $getScriptHashUtxos(scripthash: string): Promise<IEsploraApi.UTXO[]> {
    const utxos = await this.$getScriptHashUnspent(scripthash);
    const result: IEsploraApi.UTXO[] = [];
    for(const utxo of utxos) {
      if(utxo.height===0) {
        //Unconfirmed
        result.push({
          txid: utxo.tx_hash,
          vout: utxo.tx_pos,
          status: {
            confirmed: false
          },
          value: utxo.value
        });
      } else {
        //Confirmed
        const blockHash = await this.$getBlockHash(utxo.height);
        const block = await this.$getBlock(blockHash);
        result.push({
          txid: utxo.tx_hash,
          vout: utxo.tx_pos,
          status: {
            confirmed: true,
            block_height: utxo.height,
            block_hash: blockHash,
            block_time: block.timestamp
          },
          value: utxo.value
        });
      }
    }
    return result;
  }

  private $getScriptHashUnspent(scriptHash: string): Promise<IElectrumApi.ScriptHashUtxos[]> {
    return this.electrumClient.blockchainScripthash_listunspent(scriptHash);
  }

  /**
   * Fetch a confirmed transaction from the Electrum server rather than from Core.
   *
   * This is the whole reason this fork exists. Upstream inherits
   * BitcoinApi.$getRawTransaction, which calls `getrawtransaction txid true`
   * with no blockhash, and Core can only answer that from its mempool or with
   * `txindex`. `txindex` is incompatible with pruning ("Prune mode is
   * incompatible with -txindex"), so upstream Mempool cannot run against a
   * pruned node at all. Electrum servers keep their own txid index, which is
   * exactly the thing `txindex` would have provided.
   *
   * Nothing is reconstructed here. `blockchain.transaction.get(txid, true)`
   * returns Core's verbose object verbatim, because the server passes the
   * request through and hands back the JSON as-is, so it is already the
   * IBitcoinApi.Transaction shape $convertTransaction consumes. Note that on a
   * pruned node the server needs a proxy that can serve `getrawtransaction`
   * with a blockhash; btc-rpc-proxy does since v0.7.
   *
   * Unconfirmed transactions keep the inherited path: they are in the node's
   * own mempool, so Core answers without txindex and without a blockhash, and
   * that path already has the fee data cached.
   *
   * Falls back to Core on any Electrum failure, so one build serves both a
   * pruned node and an archival one with txindex.
   */
  /** @asyncUnsafe */
  async $getRawTransaction(txId: string, skipConversion = false, addPrevout = false, lazyPrevouts = false): Promise<IEsploraApi.Transaction> {
    if (mempool.getMempool()[txId]) {
      return super.$getRawTransaction(txId, skipConversion, addPrevout, lazyPrevouts);
    }

    let transaction: IBitcoinApi.Transaction;
    try {
      transaction = await this.electrumClient.blockchainTransaction_get(txId, true);
    } catch (e) {
      logger.debug(`Electrum could not serve ${txId}, falling back to Core: ` + (e instanceof Error ? e.message : e));
      return super.$getRawTransaction(txId, skipConversion, addPrevout, lazyPrevouts);
    }
    if (!transaction || !transaction.txid) {
      return super.$getRawTransaction(txId, skipConversion, addPrevout, lazyPrevouts);
    }

    if (skipConversion) {
      transaction.vout.forEach((vout) => {
        vout.value = Math.round(vout.value * 100000000);
      });
      return transaction as any as IEsploraApi.Transaction;
    }
    return this.$convertTransaction(transaction, addPrevout, lazyPrevouts);
  }

  /**
   * Every transaction in a block, preferring the one call that already answers.
   *
   * Two routes, and which one runs is decided by whether the node still has the
   * block.
   *
   * A block the node has: `getblock <hash> 2` returns every transaction AND a
   * per-transaction fee, in a single call. Measured on a live pruned mainnet node,
   * a 180-transaction block: 12ms.
   *
   * A block the node has pruned: verbosity 2 needs the undo data that pruning
   * discarded, so it fails. btc-rpc-proxy serves verbosity 0 and 1 by fetching the
   * block from peers, but it cannot reconstruct fees, so the transactions come
   * from the Electrum server instead and their fees are recomputed from inputs.
   *
   * An earlier version of this method took the second route always, on the
   * reasoning that Core's fee "is discarded either way" because callers pass
   * addPrevout=true and $convertTransaction recomputes it. That is true, and on an
   * archival node it is nearly free. On a pruned node it is the difference between
   * working and not: recomputing a fee reads every input's previous transaction,
   * those live in blocks the node no longer has, and each one becomes a peer block
   * fetch through the proxy at max_peer_concurrency 3. Measured on block 963262 of
   * the BLAKE2b chain: 180 transactions, 296 inputs, 288 distinct previous
   * transactions, none of them resolvable locally. About 468 round trips for one
   * block, against a 12ms call that already had the answer. Under that load even a
   * trivial Electrum request took 4.1 seconds against 24-89ms idle, so a single
   * block took longer than the block interval and the backend fell behind forever.
   *
   * So prevouts are not resolved on this path. Fees come from Core, which is the
   * authority for them anyway. `vin[].prevout` stays null, which block indexing
   * does not read: it needs fee and weight. The transaction page resolves prevouts
   * on demand, for the one transaction being looked at, and still does.
   *
   * `fallbackToCore` is the caller's `stale` flag, and it means here what it means
   * in the Esplora backend: an indexer follows the main chain, so a block that is
   * not on it may be absent from the index and Core is then the better source.
   */
  /** @asyncUnsafe */
  async $getTxsForBlock(hash: string, fallbackToCore = false): Promise<IEsploraApi.Transaction[]> {
    try {
      return await this.$getTxsForBlockFromCore(hash);
    } catch (e) {
      logger.debug(`Core could not serve block ${hash} at verbosity 2 (likely pruned), using Electrum: ` + (e instanceof Error ? e.message : e));
    }

    let block: IBitcoinApi.Block;
    let rawTxs: IBitcoinApi.Transaction[];
    try {
      block = await this.bitcoindClient.getBlock(hash, 1);
      // IBitcoinApi.Block types `tx` as Transaction[], but at verbosity 1 the
      // RPC returns txids, which is what the interface's own comment on
      // VerboseBlock.tx says and what the inherited $getTxIdsForBlock relies on.
      const txIds = block.tx as unknown as string[];
      rawTxs = await this.$getVerboseTransactionsBatched(txIds);
    } catch (e) {
      if (!fallbackToCore) {
        throw e;
      }
      logger.debug(`Electrum could not serve the transactions of block ${hash}, falling back to Core: ` + (e instanceof Error ? e.message : e));
      return super.$getTxsForBlock(hash, fallbackToCore);
    }

    const transactions: IEsploraApi.Transaction[] = [];
    for (const tx of rawTxs) {
      const converted = await this.$convertTransaction(tx, true, false, block.confirmations === -1);
      converted.status = {
        confirmed: true,
        block_height: block.height,
        block_hash: hash,
        block_time: block.time,
      };
      transactions.push(converted);
    }
    return transactions;
  }

  /**
   * The single-call route: `getblock <hash> 2`, with Core's own fees.
   *
   * addPrevout is false, so $convertTransaction does not walk the inputs. It also
   * leaves `fee` at 0, so the fee is filled in here from what Core reported.
   * Core gives it in BTC; every other fee in this codebase is in satoshis.
   *
   * Throws for a pruned block, which is the signal to take the Electrum route.
   */
  /** @asyncUnsafe */
  private async $getTxsForBlockFromCore(hash: string): Promise<IEsploraApi.Transaction[]> {
    const verboseBlock: IBitcoinApi.VerboseBlock = await this.bitcoindClient.getBlock(hash, 2);
    const transactions: IEsploraApi.Transaction[] = [];
    for (const tx of verboseBlock.tx) {
      const converted = await this.$convertTransaction(tx, false, false, true);
      converted.fee = tx.fee !== undefined ? Math.round(tx.fee * 100000000) : 0;
      converted.status = {
        confirmed: true,
        block_height: verboseBlock.height,
        block_hash: hash,
        block_time: verboseBlock.time,
      };
      transactions.push(converted);
    }
    return transactions;
  }

  /**
   * Verbose transactions for a list of txids, in the order asked for.
   *
   * Batched because the alternative is one round trip per transaction and a
   * block holds thousands. electrs answers a batch by running the calls in
   * sequence and returning one array, so this saves the round trips rather than
   * the server's work, which is the part that is worth saving over Tor.
   *
   * Chunked because the whole response is buffered as one string at both ends,
   * and a block's worth of verbose transactions in a single array is tens of
   * megabytes.
   *
   * Results are matched by the txid each one reports rather than by position:
   * JSON-RPC does not promise a batch comes back in order. Any txid that does
   * not come back throws, whether the server errored on it, omitted it, or does
   * not support batching at all and answered with something that is not an
   * array. A block missing transactions is worse than a block that failed to
   * load, so this must not return a partial list.
   */
  /** @asyncUnsafe */
  private async $getVerboseTransactionsBatched(txIds: string[]): Promise<IBitcoinApi.Transaction[]> {
    const byTxId = new Map<string, IBitcoinApi.Transaction>();

    for (let i = 0; i < txIds.length; i += BitcoindElectrsApi.TRANSACTION_BATCH_SIZE) {
      const chunk = txIds.slice(i, i + BitcoindElectrsApi.TRANSACTION_BATCH_SIZE);
      const responses = await this.electrumClient.blockchainTransaction_getBatch(chunk, true);
      if (!Array.isArray(responses)) {
        throw new Error('Electrum returned a non-array response to a batched transaction request');
      }
      for (const response of responses) {
        const tx: IBitcoinApi.Transaction | undefined = response?.result;
        if (tx?.txid) {
          byTxId.set(tx.txid, tx);
        }
      }
    }

    return txIds.map((txId) => {
      const tx = byTxId.get(txId);
      if (!tx) {
        throw new Error(`Electrum did not return transaction ${txId}`);
      }
      return tx;
    });
  }

  /** @asyncUnsafe */
  async $getTransactionMerkleProof(txId: string): Promise<IEsploraApi.MerkleProof> {
    const tx = await this.$getRawTransaction(txId);
    return this.electrumClient.blockchainTransaction_getMerkle(txId, tx.status.block_height);
  }

  private $getScriptHashBalance(scriptHash: string): Promise<IElectrumApi.ScriptHashBalance> {
    return this.electrumClient.blockchainScripthash_getBalance(this.encodeScriptHash(scriptHash));
  }

  private $getScriptHashHistory(scriptHash: string): Promise<IElectrumApi.ScriptHashHistory[]> {
    const fromCache = memoryCache.get<IElectrumApi.ScriptHashHistory[]>('Scripthash_getHistory', scriptHash);
    if (fromCache) {
      return Promise.resolve(fromCache);
    }
    return this.electrumClient.blockchainScripthash_getHistory(this.encodeScriptHash(scriptHash))
      .then((history) => {
        memoryCache.set('Scripthash_getHistory', scriptHash, history, 2);
        return history;
      });
  }

  private encodeScriptHash(scriptPubKey: string): string {
    const addrScripthash = crypto.enc.Hex.stringify(crypto.SHA256(crypto.enc.Hex.parse(scriptPubKey)));
    return addrScripthash!.match(/.{2}/g)!.reverse().join('');
  }

}

export default BitcoindElectrsApi;
