import { query } from '../../utils/axios-query';

/**
 * The fiat price of the BLAKE2b chain's coin (BTCB2), the way Lightning Fork's
 * dashboard and Sparrow BLAKE2b get it.
 *
 * BTCB2 trades on neoxa.exchange, and its deepest dollar market there is
 * BTCB2_USDC, so that pair's last trade is the dollar price; USDC is treated as
 * a dollar. It is not BTCB2_BTC times an outside BTC price, the obvious
 * construction: Neoxa's BTC market is thin enough to drift a few percent from
 * the wider market, and multiplying by an outside price counts that gap twice.
 * Other currencies borrow a conversion from Coingecko's rate table, the ratio
 * of its BTC-in-currency quote to its BTC-in-dollars quote, which cancels BTC
 * out, so what bitcoin on the other chain is worth cannot reach the result.
 *
 * History comes from the hourly candles behind Neoxa's own trading chart
 * (`/api/exchange/candles/<pair>`), which reach back to the pair's listing on
 * 2026-09-01. Its documented feeds (the CMC and CoinGecko ones) carry only the
 * latest trades.
 */

export const NEOXA_TICKER_URL = 'https://neoxa.exchange/api/v1/cmc/ticker';
export const COINGECKO_RATES_URL = 'https://api.coingecko.com/api/v3/exchange_rates';
export const BTCB2_USD_PAIR = 'BTCB2_USDC';
export const NEOXA_CANDLES_URL = `https://neoxa.exchange/api/exchange/candles/${BTCB2_USD_PAIR}?interval=1h&limit=5000`;

/**
 * The first block of the BLAKE2b chain that the SHA256 chain does not share,
 * which tells the two apart, and the first height where they differ, whose
 * time is when BTCB2 became a coin of its own.
 */
export const BLAKE2B_MARKER = {
  height: 961640,
  hash: '0000000000000050c1e5f69672f459293be14f46e5a494e7a8c8541396f18eeb',
};
export const FORK_HEIGHT = 961632;

/** A traded price, or null: a pair that has never traded reports zero. */
export function validPrice(value: unknown): number | null {
  const price = Number(value);
  if (value === null || value === undefined || !Number.isFinite(price) || price <= 0) {
    return null;
  }
  return price;
}

/** BTCB2 in dollars from Neoxa's ticker feed, an object keyed by pair. */
export function btcb2UsdFromTickers(tickers: any): number | null {
  if (!tickers || typeof tickers !== 'object') {
    return null;
  }
  const ticker = tickers[BTCB2_USD_PAIR];
  return ticker ? validPrice(ticker.last_price) : null;
}

/** What Coingecko's rate table says one bitcoin is worth in a currency, whatever case it uses. */
function btcIn(rates: any, currency: string): number | null {
  if (!rates?.rates || typeof rates.rates !== 'object') {
    return null;
  }
  const wanted = currency.toLowerCase();
  const key = Object.keys(rates.rates).find(k => k.toLowerCase() === wanted);
  return key === undefined ? null : validPrice(rates.rates[key]?.value);
}

/**
 * BTCB2 in each currency, rounded to cents, or -1 where it is not known: dollars
 * need only Neoxa, and the rest also need Coingecko to quote both the currency
 * and dollars. A dollar figure under another currency's name is worse than none.
 */
export function btcb2Prices(btcb2Usd: number | null, rates: any, currencies: string[]): { [currency: string]: number } {
  const out: { [currency: string]: number } = {};
  const btcUsd = btcIn(rates, 'USD');
  for (const currency of currencies) {
    let price: number | null = null;
    if (btcb2Usd !== null) {
      if (currency === 'USD') {
        price = btcb2Usd;
      } else {
        const btcCurrency = btcIn(rates, currency);
        if (btcUsd !== null && btcCurrency !== null) {
          price = btcb2Usd * (btcCurrency / btcUsd);
        }
      }
    }
    out[currency] = price === null ? -1 : Math.round(price * 100) / 100;
  }
  return out;
}

/** @asyncUnsafe */
export async function $fetchBtcb2Prices(currencies: string[]): Promise<{ [currency: string]: number }> {
  const tickers = await query(NEOXA_TICKER_URL);
  // Dollars do not need the rate table, so its absence costs only the other currencies.
  const rates = await query(COINGECKO_RATES_URL).catch(() => undefined);
  return btcb2Prices(btcb2UsdFromTickers(tickers), rates, currencies);
}

/**
 * Hourly BTCB2 dollar prices from Neoxa's candles: each hour's close, keyed by the
 * hour's start, which is how the Kraken history is keyed too. Oldest first.
 */
export function btcb2HourlyCloses(response: any): { time: number, open: number, close: number }[] {
  const candles = Array.isArray(response?.candles) ? response.candles : [];
  const out: { time: number, open: number, close: number }[] = [];
  for (const candle of candles) {
    const time = Number(candle?.time);
    const open = validPrice(candle?.open);
    const close = validPrice(candle?.close);
    if (Number.isInteger(time) && time > 0 && open !== null && close !== null) {
      out.push({ time, open: Math.round(open * 100) / 100, close: Math.round(close * 100) / 100 });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

/** @asyncUnsafe */
export async function $fetchBtcb2HourlyCloses(): Promise<{ time: number, open: number, close: number }[]> {
  return btcb2HourlyCloses(await query(NEOXA_CANDLES_URL));
}
