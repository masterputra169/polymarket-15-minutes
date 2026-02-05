import React from 'react';
import { formatNumber, formatSignedDelta, narrativeFromSign } from '../utils.js';

function SignalRow({ name, value, narrative }) {
  const cls =
    narrative === 'LONG'
      ? 'ta-signal-row--long'
      : narrative === 'SHORT'
        ? 'ta-signal-row--short'
        : 'ta-signal-row--neutral';

  const colorCls =
    narrative === 'LONG' ? 'c-green' : narrative === 'SHORT' ? 'c-red' : 'c-muted';

  return (
    <div className={`ta-signal-row ${cls}`}>
      <span className="ta-signal-row__name">{name}</span>
      <span className={`ta-signal-row__value ${colorCls}`}>{value}</span>
    </div>
  );
}

export default function TAIndicators({ data }) {
  if (!data) return null;

  const {
    consec,
    haNarrative,
    rsiNow,
    rsiSlope,
    rsiNarrative,
    macdLabel,
    macdNarrative,
    delta1m,
    delta3m,
    lastClose,
    vwapNow,
    vwapDist,
    vwapSlopeLabel,
    vwapNarrative,
  } = data;

  const heikenValue = `${consec?.color ?? '-'} x${consec?.count ?? 0}`;

  const rsiArrow =
    rsiSlope !== null && rsiSlope < 0 ? '↓' : rsiSlope !== null && rsiSlope > 0 ? '↑' : '-';
  const rsiValue = `${formatNumber(rsiNow, 1)} ${rsiArrow}`;

  const delta1Narrative = narrativeFromSign(delta1m);
  const delta3Narrative = narrativeFromSign(delta3m);

  const d1 = formatSignedDelta(delta1m, lastClose);
  const d3 = formatSignedDelta(delta3m, lastClose);

  const vwapValue = `${formatNumber(vwapNow, 0)} (${vwapDist !== null ? (vwapDist * 100).toFixed(2) + '%' : '-'}) | slope: ${vwapSlopeLabel}`;

  return (
    <div className="card" style={{ animationDelay: '0.1s' }}>
      <div className="card__header">
        <span className="card__title">📊 TA Indicators</span>
        <span className="card__badge badge--live">LIVE</span>
      </div>
      <SignalRow name="Heiken Ashi" value={heikenValue} narrative={haNarrative} />
      <SignalRow name="RSI" value={rsiValue} narrative={rsiNarrative} />
      <SignalRow name="MACD" value={macdLabel} narrative={macdNarrative} />
      <SignalRow
        name="Delta 1min"
        value={d1}
        narrative={delta1Narrative}
      />
      <SignalRow
        name="Delta 3min"
        value={d3}
        narrative={delta3Narrative}
      />
      <SignalRow name="VWAP" value={vwapValue} narrative={vwapNarrative} />
    </div>
  );
}
