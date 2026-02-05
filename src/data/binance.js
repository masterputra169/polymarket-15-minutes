import { CONFIG } from '../config.js';
import { toNumber } from '../utils.js';

export async function fetchKlines({ interval, limit }) {
  const url = `${CONFIG.binanceBaseUrl}/api/v3/klines?symbol=${CONFIG.symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance klines error: ${res.status}`);
  const data = await res.json();
  return data.map((k) => ({
    openTime: Number(k[0]),
    open: toNumber(k[1]),
    high: toNumber(k[2]),
    low: toNumber(k[3]),
    close: toNumber(k[4]),
    volume: toNumber(k[5]),
    closeTime: Number(k[6]),
  }));
}

export async function fetchLastPrice() {
  const url = `${CONFIG.binanceBaseUrl}/api/v3/ticker/price?symbol=${CONFIG.symbol}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance price error: ${res.status}`);
  const data = await res.json();
  return toNumber(data.price);
}
