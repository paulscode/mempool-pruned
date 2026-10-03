/**
 * FundingTxFetcher on a pruned node.
 *
 * Upstream reads a channel's whole funding block and then the transaction by
 * txid, which needs `txindex` and the block; a pruned node has neither for
 * most channels. The Lightning node already knows the funding outpoint and
 * the capacity, so when the caller passes those, only the block header (which
 * a pruned node keeps) is read, for the date.
 */

const mockClient = {
  getBlockHash: jest.fn(),
  getBlockHeader: jest.fn(),
  getBlock: jest.fn(),
  getRawTransaction: jest.fn(),
};

jest.mock('../../api/bitcoin/bitcoin-client', () => ({
  __esModule: true,
  default: mockClient,
}));

import fetcher, { txidOfChanPoint } from '../../tasks/lightning/sync-tasks/funding-tx-fetcher';

const TXID = 'ab'.repeat(32);

beforeEach(() => {
  jest.clearAllMocks();
  fetcher.fundingTxCache = {};
  mockClient.getBlockHash.mockResolvedValue('00'.repeat(32));
});

test('with what the Lightning node knows, only the header is read', async () => {
  mockClient.getBlockHeader.mockResolvedValue({ time: 1790000000 });
  mockClient.getBlock.mockRejectedValue(new Error('Block not available (pruned data)'));

  const tx = await fetcher.$fetchChannelOpenTx('975311x314x0', { txid: TXID, value: 0.01 });

  expect(tx).toEqual({ timestamp: 1790000000, txid: TXID, value: 0.01 });
  expect(mockClient.getBlock).not.toHaveBeenCalled();
  expect(mockClient.getRawTransaction).not.toHaveBeenCalled();
});

test('without it, the block is read with its transactions, no txindex needed', async () => {
  mockClient.getBlock.mockResolvedValue({
    time: 1790000100,
    tx: [{ txid: 'cc'.repeat(32), vout: [] }, { txid: TXID, vout: [{ value: 0.5 }, { value: 0.02 }] }],
  });

  const tx = await fetcher.$fetchChannelOpenTx('975312x1x1');

  expect(tx).toEqual({ timestamp: 1790000100, txid: TXID, value: 0.02 });
  expect(mockClient.getBlock).toHaveBeenCalledWith('00'.repeat(32), 2);
  expect(mockClient.getRawTransaction).not.toHaveBeenCalled();
});

test('a pruned block with nothing known is skipped, not an error thrown', async () => {
  mockClient.getBlock.mockRejectedValue(new Error('Block not available (pruned data)'));

  expect(await fetcher.$fetchChannelOpenTx('975313x2x0')).toBeNull();
  // Half-known (no capacity) is not enough to stand in for the chain.
  expect(await fetcher.$fetchChannelOpenTx('975313x2x0', { txid: TXID })).toBeNull();
});

test('the funding txid of a channel point', () => {
  expect(txidOfChanPoint(`${TXID}:1`)).toBe(TXID);
  expect(txidOfChanPoint('')).toBe('');
  expect(txidOfChanPoint('nonsense:0')).toBe('');
});
