/**
 * $getTxsForBlock on the Electrum backend.
 *
 * This is the path that lets a block page work on a pruned node without
 * `getblock` verbosity 2, which btc-rpc-proxy does not serve. It is also a path
 * that production rarely exercises: with BACKEND: 'electrum' the bulk block
 * processing route never calls it, so it is reached mostly for stale blocks.
 * Rarely reached is exactly why the invariants are worth pinning down here
 * rather than discovering during a reorg.
 */

const mockBatch = jest.fn();

jest.mock('@mempool/electrum-client', () => {
  return jest.fn().mockImplementation(() => ({
    initElectrum: jest.fn().mockResolvedValue(undefined),
    blockchainTransaction_getBatch: mockBatch,
  }));
});

// There is a pre-existing import cycle, bitcoin-api -> blocks ->
// bitcoin-api-factory -> bitcoin-api: the factory calls `new BitcoinApi()`
// while its module body runs, so reaching it through a half-evaluated
// bitcoin-api leaves it with an undefined constructor. The application enters
// through `blocks` and so never sees it; a test importing electrum-api
// directly does. Stubbing the two app singletons cuts the cycle without
// standing up the whole backend, which is also what keeps this test from
// opening a database connection. Only the members bitcoin-api actually calls
// are needed.
jest.mock('../../api/bitcoin/bitcoin-api-factory', () => ({
  __esModule: true,
  default: {},
}));
jest.mock('../../api/blocks', () => ({
  __esModule: true,
  default: { getBlocks: () => [], getCurrentBlockHeight: () => 800000 },
}));
jest.mock('../../api/mempool', () => ({
  __esModule: true,
  default: { getMempool: () => ({}), isInSync: () => true },
}));

import BitcoindElectrsApi from '../../api/bitcoin/electrum-api';

/** A verbose transaction, cut down to the fields $convertTransaction reads. */
function tx(txid: string): any {
  return {
    txid,
    version: 2,
    locktime: 0,
    size: 200,
    weight: 800,
    vin: [{ coinbase: 'aa', sequence: 0xffffffff, txinwitness: [] }],
    vout: [{ value: 0.5, scriptPubKey: { hex: '00', type: 'pubkeyhash', address: 'bc1qexample' } }],
  };
}

/** What the client resolves a batch to: raw JSON-RPC response objects. */
function ok(txid: string, id: number): any {
  return { jsonrpc: '2.0', id, result: tx(txid), param: txid };
}

function makeApi(txIds: string[], confirmations = 10): BitcoindElectrsApi {
  const bitcoindClient = {
    getBlock: jest.fn().mockResolvedValue({
      hash: 'blockhash',
      height: 800000,
      time: 1700000000,
      confirmations,
      tx: txIds,
    }),
  };
  return new BitcoindElectrsApi(bitcoindClient as any);
}

describe('BitcoindElectrsApi.$getTxsForBlock', () => {
  beforeEach(() => {
    mockBatch.mockReset();
  });

  test('returns transactions in block order even when the batch comes back shuffled', async () => {
    const txIds = ['aa', 'bb', 'cc'];
    // JSON-RPC does not promise batch responses arrive in request order.
    mockBatch.mockResolvedValue([ok('cc', 3), ok('aa', 1), ok('bb', 2)]);

    const txs = await makeApi(txIds).$getTxsForBlock('blockhash');

    expect(txs.map((t) => t.txid)).toEqual(['aa', 'bb', 'cc']);
  });

  test('stamps every transaction with the block it was asked for', async () => {
    mockBatch.mockResolvedValue([ok('aa', 1)]);

    const txs = await makeApi(['aa']).$getTxsForBlock('blockhash');

    expect(txs[0].status).toEqual({
      confirmed: true,
      block_height: 800000,
      block_hash: 'blockhash',
      block_time: 1700000000,
    });
  });

  test('chunks a block larger than the batch size and keeps its order', async () => {
    const txIds = Array.from({ length: 250 }, (_, i) => `tx${i}`);
    mockBatch.mockImplementation((chunk: string[]) =>
      Promise.resolve(chunk.map((txid, i) => ok(txid, i + 1))),
    );

    const txs = await makeApi(txIds).$getTxsForBlock('blockhash');

    expect(mockBatch).toHaveBeenCalledTimes(3); // 100 + 100 + 50
    expect(mockBatch.mock.calls.map((c) => c[0].length)).toEqual([100, 100, 50]);
    expect(mockBatch.mock.calls.every((c) => c[1] === true)).toBe(true); // verbose
    expect(txs.map((t) => t.txid)).toEqual(txIds);
  });

  test('throws rather than returning a partial block when a transaction errors', async () => {
    // A batch resolves as a whole; a single call inside it can still fail, and
    // the item then carries `error` instead of `result`.
    mockBatch.mockResolvedValue([
      ok('aa', 1),
      { jsonrpc: '2.0', id: 2, error: { code: -5, message: 'No such transaction' }, param: 'bb' },
    ]);

    await expect(makeApi(['aa', 'bb']).$getTxsForBlock('blockhash')).rejects.toThrow(
      'Electrum did not return transaction bb',
    );
  });

  test('throws when the server omits a transaction entirely', async () => {
    mockBatch.mockResolvedValue([ok('aa', 1)]);

    await expect(makeApi(['aa', 'bb']).$getTxsForBlock('blockhash')).rejects.toThrow(
      'Electrum did not return transaction bb',
    );
  });

  test('throws when the server does not support batching', async () => {
    // A server without batch support answers the array with a single object.
    mockBatch.mockResolvedValue({ jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'Invalid request' } });

    await expect(makeApi(['aa']).$getTxsForBlock('blockhash')).rejects.toThrow(
      'non-array response',
    );
  });

  test('falls back to Core for a stale block, which an indexer need not have', async () => {
    mockBatch.mockResolvedValue([]);
    const api = makeApi(['aa'], -1);
    const fallback = jest
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(api)), '$getTxsForBlock')
      .mockResolvedValue([{ txid: 'from-core' }] as any);

    const txs = await api.$getTxsForBlock('blockhash', true);

    expect(fallback).toHaveBeenCalledWith('blockhash', true);
    expect(txs).toEqual([{ txid: 'from-core' }]);
    fallback.mockRestore();
  });

  test('does not reach for Core when the caller did not allow it', async () => {
    mockBatch.mockResolvedValue([]);
    const api = makeApi(['aa']);
    const fallback = jest
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(api)), '$getTxsForBlock')
      .mockResolvedValue([] as any);

    await expect(api.$getTxsForBlock('blockhash', false)).rejects.toThrow(
      'Electrum did not return transaction aa',
    );
    expect(fallback).not.toHaveBeenCalled();
    fallback.mockRestore();
  });
});
