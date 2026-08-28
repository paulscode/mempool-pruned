import fs from 'fs';
import path from 'path';
import os from 'os';
import { IBackendInfo } from '../mempool.interfaces';
import config from '../config';
import bitcoinClient from './bitcoin/bitcoin-client';
import logger from '../logger';

class BackendInfo {
  private backendInfo: IBackendInfo;
  private timer;

  constructor() {
    // This file is created by ./fetch-version.ts during building
    const versionFile = path.join(__dirname, 'version.json');
    let versionInfo;
    if (fs.existsSync(versionFile)) {
      versionInfo = JSON.parse(fs.readFileSync(versionFile).toString());
    } else {
      // Use dummy values if `versionFile` doesn't exist (e.g., during testing)
      versionInfo = {
        version: '?',
        gitCommit: '?'
      };
    }
    this.backendInfo = {
      hostname: os.hostname(),
      version: versionInfo.version,
      gitCommit: versionInfo.gitCommit,
      lightning: config.LIGHTNING.ENABLED,
      backend: config.MEMPOOL.BACKEND,
      coreVersion: '?',
      osVersion: `${os.type()} ${os.release()}`,
    };

    this.timer = setInterval(async () => {
      try {
        await this.$updateCoreVersion();
      } catch (e) {
        logger.err(`Exception in $updateCoreVersion. Reason: ${(e instanceof Error ? e.message : e)}`);
      }
    }, 10 * 60 * 1000); // every 10 minutes
    void this.$updateCoreVersion(); // starting immediately
  }

  /** @asyncSafe */
  private async $updateCoreVersion(): Promise<void> {
    try {
      const networkInfo = await bitcoinClient.getNetworkInfo();
      this.backendInfo.coreVersion = networkInfo.subversion;
    } catch (e) {
      logger.err(`Exception in $updateCoreVersion. Reason: ${(e instanceof Error ? e.message : e)}`);
    }
    await this.$updatePruneHeight();
  }

  /**
   * How much history the node still holds, when it is pruned.
   *
   * Blocks below this height are not on disk. Their transactions still resolve,
   * because the Electrum server fetches the blocks back from the peer-to-peer
   * network, but that costs a network round trip per block and makes an old
   * block page markedly slower than a recent one. The frontend says so rather
   * than leaving the user with unexplained, bimodal latency.
   *
   * Left undefined on an archival node, which is what keeps the notice silent
   * there: `pruneheight` is only present in getblockchaininfo when pruning is on.
   *
   * @asyncSafe
   */
  private async $updatePruneHeight(): Promise<void> {
    try {
      const blockchainInfo = await bitcoinClient.getBlockchainInfo();
      this.backendInfo.pruneHeight = blockchainInfo?.pruned
        ? blockchainInfo.pruneheight
        : undefined;
    } catch (e) {
      logger.err(`Exception in $updatePruneHeight. Reason: ${(e instanceof Error ? e.message : e)}`);
    }
  }

  public getBackendInfo(): IBackendInfo {
    return this.backendInfo;
  }

  public getShortCommitHash(): string {
    return this.backendInfo.gitCommit.slice(0, 7);
  }
}

export default new BackendInfo();
