import { CONFIG } from '../config.js';

/**
 * Chainlink BTC/USD price via Polygon HTTP RPC (browser-compatible).
 * Port of src/data/chainlink.js from the original Node.js project.
 *
 * Uses raw JSON-RPC eth_call — no ethers.js dependency needed.
 */

const RPC_TIMEOUT_MS = 3000;
const MIN_FETCH_INTERVAL_MS = 2000;

// ABI function selectors (pre-computed, no ethers needed)
// decimals() => 0x313ce567
// latestRoundData() => 0xfeaf968c
const DECIMALS_SELECTOR = '0x313ce567';
const LATEST_ROUND_DATA_SELECTOR = '0xfeaf968c';

let cachedDecimals = null;
let cachedResult = { price: null, updatedAt: null, source: 'chainlink_rpc' };
let cachedFetchedAtMs = 0;
let preferredRpcIndex = 0;

function getRpcUrls() {
  return CONFIG.chainlink?.polygonRpcUrls ?? [];
}

function getAggregator() {
  return CONFIG.chainlink?.btcUsdAggregator ?? '';
}

async function jsonRpcCall(rpcUrl, to, data) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);

  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to, data }, 'latest'],
      }),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`rpc_http_${res.status}`);

    const json = await res.json();
    if (json.error) throw new Error(`rpc_error_${json.error.code}`);

    return json.result;
  } finally {
    clearTimeout(timeout);
  }
}

function decodeUint8(hex) {
  // decimals() returns a single uint8
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  return parseInt(clean, 16);
}

function decodeLatestRoundData(hex) {
  // Returns: (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
  // Each value is 32 bytes (64 hex chars)
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;

  if (clean.length < 320) return null; // 5 * 64

  // answer is at offset 32 bytes (index 1), which is chars 64-127
  const answerHex = clean.slice(64, 128);
  // updatedAt is at offset 96 bytes (index 3), which is chars 192-255
  const updatedAtHex = clean.slice(192, 256);

  // answer is int256 (signed)
  let answer = BigInt('0x' + answerHex);
  const TWO_255 = 1n << 255n;
  const TWO_256 = 1n << 256n;
  if (answer >= TWO_255) answer = answer - TWO_256;

  const updatedAt = Number(BigInt('0x' + updatedAtHex));

  return { answer: Number(answer), updatedAt };
}

export async function fetchChainlinkBtcUsd() {
  const rpcs = getRpcUrls();
  const aggregator = getAggregator();

  if (!rpcs.length || !aggregator) {
    return { price: null, updatedAt: null, source: 'chainlink_rpc_no_config' };
  }

  const now = Date.now();
  if (cachedFetchedAtMs && now - cachedFetchedAtMs < MIN_FETCH_INTERVAL_MS) {
    return cachedResult;
  }

  // Try RPCs starting from preferred
  for (let attempt = 0; attempt < rpcs.length; attempt++) {
    const idx = (preferredRpcIndex + attempt) % rpcs.length;
    const rpc = rpcs[idx];

    try {
      // Fetch decimals if not cached
      if (cachedDecimals === null) {
        const decResult = await jsonRpcCall(rpc, aggregator, DECIMALS_SELECTOR);
        cachedDecimals = decodeUint8(decResult);
      }

      // Fetch latest round data
      const roundResult = await jsonRpcCall(rpc, aggregator, LATEST_ROUND_DATA_SELECTOR);
      const decoded = decodeLatestRoundData(roundResult);

      if (!decoded) {
        cachedDecimals = null;
        continue;
      }

      const scale = 10 ** cachedDecimals;
      const price = decoded.answer / scale;

      cachedResult = {
        price,
        updatedAt: decoded.updatedAt * 1000,
        source: 'chainlink_rpc',
      };
      cachedFetchedAtMs = now;
      preferredRpcIndex = idx;
      return cachedResult;
    } catch {
      cachedDecimals = null;
      continue;
    }
  }

  // All RPCs failed, return last cached
  return cachedResult;
}
