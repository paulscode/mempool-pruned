import { btcb2HourlyCloses, btcb2Prices, btcb2UsdFromTickers, validPrice } from '../../tasks/price-feeds/blake2b-price';

const rates = { rates: {
  btc: { value: 1, type: 'crypto' },
  usd: { value: 100000, type: 'fiat' },
  eur: { value: 90000, type: 'fiat' },
  jpy: { value: 15000000, type: 'fiat' },
} };

describe('BTCB2 prices', () => {
  test('dollars are the BTCB2_USDC last trade, and nothing else is', () => {
    expect(btcb2UsdFromTickers({ BTCB2_USDC: { last_price: 439.82 }, BTCB2_BTC: { last_price: 0.005 } })).toBe(439.82);
    expect(btcb2UsdFromTickers({ BTCB2_BTC: { last_price: 0.005 } })).toBeNull();
    expect(btcb2UsdFromTickers({ BTCB2_USDC: { last_price: 0 } })).toBeNull(); // never traded
    expect(btcb2UsdFromTickers(undefined)).toBeNull();
    expect(validPrice('12.5')).toBe(12.5);
    expect(validPrice(-1)).toBeNull();
  });

  test('other currencies go through Coingecko\'s ratio, which cancels BTC out', () => {
    const p = btcb2Prices(440, rates, ['USD', 'EUR', 'JPY', 'GBP']);
    expect(p.USD).toBe(440);
    expect(p.EUR).toBe(396);
    expect(p.JPY).toBe(66000);
    expect(p.GBP).toBe(-1); // not quoted: unknown, not a dollar figure
  });

  test('without Neoxa nothing is known; without Coingecko dollars still are', () => {
    expect(btcb2Prices(null, rates, ['USD', 'EUR'])).toEqual({ USD: -1, EUR: -1 });
    expect(btcb2Prices(440, undefined, ['USD', 'EUR'])).toEqual({ USD: 440, EUR: -1 });
  });

  test('candles become finished hours\' closes, oldest first, skipping dust and the open hour', () => {
    const closes = btcb2HourlyCloses({ candles: [
      { time: 7200, open: 162, close: 160.055423, volume: 7.03 },
      { time: 3600, open: 161, close: 162, volume: 24.7 },
      { time: 1800, open: 77000, close: 78201, volume: 0.000029 }, // a listing's dust trade
      { time: 10800, open: 1, close: 0, volume: 5 },
      { time: 14400, open: 150, close: 151, volume: 5 }, // still open at `now`
      { time: 'x', open: 1, close: 1, volume: 5 },
    ] }, 16000);
    expect(closes).toEqual([
      { time: 3600, close: 162 },
      { time: 7200, close: 160.06 },
    ]);
    expect(btcb2HourlyCloses({ success: false })).toEqual([]);
  });
});
