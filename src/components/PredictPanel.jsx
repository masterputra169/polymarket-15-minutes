import React, { memo } from 'react';
import { formatProbPct } from '../utils.js';

function PredictPanel({ data }) {
  if (!data) return null;

  const { pLong, pShort, regimeInfo, rec } = data;

  const longPct = pLong !== null ? Math.round(pLong * 100) : 50;
  const shortPct = pShort !== null ? Math.round(pShort * 100) : 50;

  const predictNarrative =
    pLong !== null && pShort !== null
      ? pLong > pShort
        ? 'LONG'
        : pShort > pLong
          ? 'SHORT'
          : 'NEUTRAL'
      : 'NEUTRAL';

  const cardGlow =
    predictNarrative === 'LONG'
      ? 'card--glow-green'
      : predictNarrative === 'SHORT'
        ? 'card--glow-red'
        : '';

  const regimeColor =
    regimeInfo?.regime === 'TREND_UP'
      ? 'c-green'
      : regimeInfo?.regime === 'TREND_DOWN'
        ? 'c-red'
        : 'c-yellow';

  const signalText =
    rec?.action === 'ENTER'
      ? rec.side === 'UP'
        ? 'BUY UP'
        : 'BUY DOWN'
      : 'NO TRADE';
  const signalColor =
    rec?.action === 'ENTER'
      ? rec.side === 'UP'
        ? 'c-green'
        : 'c-red'
      : 'c-muted';

  return (
    <div className={`card ${cardGlow}`} style={{ animationDelay: '0.15s' }}>
      <div className="card__header">
        <span className="card__title">🎯 Prediction</span>
        {rec?.action === 'ENTER' && (
          <span
            className="card__badge"
            style={{
              background: rec.side === 'UP' ? 'var(--green-bg)' : 'var(--red-bg)',
              color: rec.side === 'UP' ? 'var(--green-bright)' : 'var(--red-bright)',
              border: `1px solid ${rec.side === 'UP' ? 'rgba(0,230,118,0.2)' : 'rgba(255,82,82,0.2)'}`,
            }}
          >
            {rec.strength}
          </span>
        )}
      </div>

      <div className="prob-bar-container">
        <div className="prob-bar">
          <div className="prob-bar__up" style={{ width: `${longPct}%` }}>
            ↑ {formatProbPct(pLong, 0)}
          </div>
          <div className="prob-bar__down" style={{ width: `${shortPct}%` }}>
            ↓ {formatProbPct(pShort, 0)}
          </div>
        </div>
        <div className="prob-labels">
          <span>LONG</span>
          <span>SHORT</span>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <div className="data-row">
          <span className="data-row__label">Regime</span>
          <span className={`data-row__value ${regimeColor}`}>
            {regimeInfo?.regime ?? '-'}
          </span>
        </div>
        <div className="data-row">
          <span className="data-row__label">Phase</span>
          <span className="data-row__value">{rec?.phase ?? '-'}</span>
        </div>
        <div className="data-row">
          <span className="data-row__label">Signal</span>
          <span className={`data-row__value ${signalColor}`} style={{ fontWeight: 600 }}>
            {signalText}
          </span>
        </div>
        {rec?.edge !== undefined && rec.edge !== null && (
          <div className="data-row">
            <span className="data-row__label">Edge</span>
            <span className="data-row__value">
              {(rec.edge * 100).toFixed(1)}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══ React.memo with custom comparator ═══
// Only re-render when prediction-specific fields change
export default memo(PredictPanel, (prev, next) => {
  const a = prev.data;
  const b = next.data;
  if (!a || !b) return a === b;
  return (
    a.pLong === b.pLong &&
    a.pShort === b.pShort &&
    a.regimeInfo?.regime === b.regimeInfo?.regime &&
    a.rec?.action === b.rec?.action &&
    a.rec?.side === b.rec?.side &&
    a.rec?.strength === b.rec?.strength &&
    a.rec?.phase === b.rec?.phase &&
    a.rec?.edge === b.rec?.edge
  );
});