export function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

export function formatNumber(x, digits = 0) {
  if (x === null || x === undefined || Number.isNaN(x)) return '-';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(x);
}

export function formatPct(x, digits = 2) {
  if (x === null || x === undefined || Number.isNaN(x)) return '-';
  return `${(x * 100).toFixed(digits)}%`;
}

export function formatProbPct(p, digits = 0) {
  if (p === null || p === undefined || !Number.isFinite(Number(p))) return '-';
  return `${(Number(p) * 100).toFixed(digits)}%`;
}

export function getCandleWindowTiming(windowMinutes) {
  const nowMs = Date.now();
  const windowMs = windowMinutes * 60_000;
  const startMs = Math.floor(nowMs / windowMs) * windowMs;
  const endMs = startMs + windowMs;
  const elapsedMs = nowMs - startMs;
  const remainingMs = endMs - nowMs;
  return {
    startMs,
    endMs,
    elapsedMs,
    remainingMs,
    elapsedMinutes: elapsedMs / 60_000,
    remainingMinutes: remainingMs / 60_000,
  };
}

export function fmtTimeLeft(mins) {
  const totalSeconds = Math.max(0, Math.floor(mins * 60));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function fmtEtTime(now = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(now);
  } catch {
    return '-';
  }
}

export function getBtcSession(now = new Date()) {
  const h = now.getUTCHours();
  const inAsia = h >= 0 && h < 8;
  const inEurope = h >= 7 && h < 16;
  const inUs = h >= 13 && h < 22;

  if (inEurope && inUs) return 'Europe/US Overlap';
  if (inAsia && inEurope) return 'Asia/Europe Overlap';
  if (inAsia) return 'Asia';
  if (inEurope) return 'Europe';
  if (inUs) return 'US';
  return 'Off-hours';
}

export function formatSignedDelta(delta, base) {
  if (delta === null || base === null || base === 0) return '-';
  const sign = delta > 0 ? '+' : delta < 0 ? '-' : '';
  const pct = (Math.abs(delta) / Math.abs(base)) * 100;
  return `${sign}$${Math.abs(delta).toFixed(2)} (${sign}${pct.toFixed(2)}%)`;
}

export function narrativeFromSign(x) {
  if (x === null || x === undefined || !Number.isFinite(Number(x)) || Number(x) === 0) return 'NEUTRAL';
  return Number(x) > 0 ? 'LONG' : 'SHORT';
}

export function narrativeFromRsi(rsi) {
  if (rsi === null || rsi === undefined || !Number.isFinite(Number(rsi))) return 'NEUTRAL';
  const v = Number(rsi);
  if (v >= 55) return 'LONG';
  if (v <= 45) return 'SHORT';
  return 'NEUTRAL';
}

export function narrativeFromSlope(slope) {
  if (slope === null || slope === undefined || !Number.isFinite(Number(slope)) || Number(slope) === 0) return 'NEUTRAL';
  return Number(slope) > 0 ? 'LONG' : 'SHORT';
}

function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

export { toNumber };
