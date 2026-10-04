/**
 * Common.blockStatsFromRawBlock: getblockstats for a block the node has pruned.
 *
 * Checked against Core's own getblockstats on two mainnet blocks of about 4,000
 * and 5,000 transactions when it was written: every count, size, weight, total
 * and average matched exactly, and only the fee distribution (by design, the
 * average) differed. Those blocks are megabytes, so this pins the same
 * definitions on a block built here instead.
 */
import * as bitcoinjs from 'bitcoinjs-lib';
import { Common } from '../../api/common';

function tx(inputs: number, outputs: number[], witness: boolean, coinbase = false): bitcoinjs.Transaction {
  const t = new bitcoinjs.Transaction();
  for (let i = 0; i < inputs; i++) {
    const hash = Buffer.alloc(32, coinbase ? 0 : i + 1);
    t.addInput(hash, coinbase ? 0xffffffff : i, 0xffffffff, Buffer.from(coinbase ? '03a0bb0d' : '', 'hex'));
    if (witness) {
      t.setWitness(i, [Buffer.alloc(72, 1), Buffer.alloc(33, 2)]);
    }
  }
  for (const value of outputs) {
    t.addOutput(Buffer.from('0014' + '11'.repeat(20), 'hex'), value);
  }
  return t;
}

describe('Common.blockStatsFromRawBlock', () => {
  const height = 840000; // fourth halving: a 3.125 coin subsidy
  const subsidy = 312500000;
  const fees = 1500 + 2500;
  const legacy = tx(2, [1000, 2000], false);
  const segwit = tx(1, [3000], true);
  const block = new bitcoinjs.Block();
  block.version = 0x20000000;
  block.prevHash = Buffer.alloc(32, 0);
  block.merkleRoot = Buffer.alloc(32, 0);
  block.timestamp = 1713571767;
  block.bits = 0x17034219;
  block.nonce = 0;
  block.transactions = [tx(1, [subsidy + fees - 100, 100], true, true), legacy, segwit];
  const stats = Common.blockStatsFromRawBlock(block.toHex(), height, 'ab'.repeat(32), 1713570000);

  test('counts and totals cover non-coinbase transactions, as Core does', () => {
    expect(stats.txs).toBe(3);
    expect(stats.ins).toBe(3);
    expect(stats.outs).toBe(5); // outputs include the coinbase's
    expect(stats.utxo_increase).toBe(2);
    expect(stats.total_out).toBe(6000);
    expect(stats.total_size).toBe(legacy.byteLength() + segwit.byteLength());
    expect(stats.total_weight).toBe(legacy.weight() + segwit.weight());
    expect(stats.swtxs).toBe(1);
    expect(stats.swtotal_size).toBe(segwit.byteLength());
    expect(stats.swtotal_weight).toBe(segwit.weight());
  });

  test('the total fee is the coinbase less the subsidy, and the averages follow', () => {
    expect(stats.subsidy).toBe(subsidy);
    expect(stats.totalfee).toBe(fees);
    expect(stats.avgfee).toBe(fees / 2);
    const rate = Math.floor(fees * 4 / (legacy.weight() + segwit.weight()));
    expect(stats.avgfeerate).toBe(rate);
    expect(stats.feerate_percentiles).toEqual([rate, rate, rate, rate, rate]);
    expect(stats.minfeerate).toBe(rate);
    expect(stats.maxfeerate).toBe(rate);
  });

  test('times come from the block and the given median time', () => {
    expect(stats.time).toBe(1713571767);
    expect(stats.mediantime).toBe(1713570000);
  });

  test('a coinbase that claims less than the subsidy is not a negative fee', () => {
    const b = new bitcoinjs.Block();
    Object.assign(b, { version: 1, prevHash: Buffer.alloc(32), merkleRoot: Buffer.alloc(32), timestamp: 1, bits: 0x1d00ffff, nonce: 0 });
    b.transactions = [tx(1, [1], false, true)];
    const s = Common.blockStatsFromRawBlock(b.toHex(), 100, '00'.repeat(32));
    expect(s.totalfee).toBe(0);
    expect(s.avgfee).toBe(0);
    expect(s.avgfeerate).toBe(0);
    expect(s.subsidy).toBe(5000000000);
  });
});
