import React, { memo } from 'react';
import { formatProbPct } from '../utils.js';

function EdgePanel({ data }) {
  if (!data) return null;

  const { edge, pLong, pShort, marketUp, marketDown } = data;

  const edgeUpPct = edge?.edgeUp !== null ? (edge.edgeUp * 100).toFixed(1) : '-';
  const edgeDownPct = edge?.edgeDown !== null ? (edge.edgeDown * 100).toFixed(1) : '-';

  return (
    <div className="card" style={{ animationDelay: '0.25s' }}>
      <div className="card__header">
        <span className="card__title">⚖️ Edge Analysis</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>
            Model
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <span className="c-green" style={{ fontWeight: 600 }}>
              ↑ {formatProbPct(pLong, 1)}
            </span>
            <span className="c-red" style={{ fontWeight: 600 }}>
              ↓ {formatProbPct(pShort, 1)}
            </span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>
            Market
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <span className="c-green" style={{ fontWeight: 600 }}>
              ↑ {marketUp !== null ? `${marketUp}¢` : '-'}
            </span>
            <span className="c-red" style={{ fontWeight: 600 }}>
              ↓ {marketDown !== null ? `${marketDown}¢` : '-'}
            </span>
          </div>
        </div>
      </div>

      <div className="data-row">
        <span className="data-row__label">Edge UP</span>
        <span className={`data-row__value ${edge?.edgeUp > 0 ? 'c-green' : edge?.edgeUp < 0 ? 'c-red' : ''}`}>
          {edgeUpPct !== '-' ? `${edge.edgeUp > 0 ? '+' : ''}${edgeUpPct}%` : '-'}
        </span>
      </div>
      <div className="data-row">
        <span className="data-row__label">Edge DOWN</span>
        <span className={`data-row__value ${edge?.edgeDown > 0 ? 'c-green' : edge?.edgeDown < 0 ? 'c-red' : ''}`}>
          {edgeDownPct !== '-' ? `${edge.edgeDown > 0 ? '+' : ''}${edgeDownPct}%` : '-'}
        </span>
      </div>
    </div>
  );
}

// ═══ React.memo with custom comparator ═══
// Only re-render when edge-specific fields change
export default memo(EdgePanel, (prev, next) => {
  const a = prev.data;
  const b = next.data;
  if (!a || !b) return a === b;
  return (
    a.edge?.edgeUp === b.edge?.edgeUp &&
    a.edge?.edgeDown === b.edge?.edgeDown &&
    a.pLong === b.pLong &&
    a.pShort === b.pShort &&
    a.marketUp === b.marketUp &&
    a.marketDown === b.marketDown
  );
});