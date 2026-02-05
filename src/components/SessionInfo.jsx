import React from 'react';
import { fmtEtTime, getBtcSession } from '../utils.js';
import { useClock } from '../hooks/useClock.js';

export default function SessionInfo() {
  const now = useClock(1000);

  const etTime = fmtEtTime(now);
  const session = getBtcSession(now);

  const sessionColor =
    session.includes('Overlap')
      ? 'c-yellow'
      : session === 'US'
        ? 'c-blue'
        : session === 'Europe'
          ? 'c-cyan'
          : session === 'Asia'
            ? 'c-green'
            : 'c-muted';

  return (
    <div className="card span-2" style={{ animationDelay: '0.3s' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>🕐 ET Time</span>
          <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{etTime}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>Session</span>
          <span className={sessionColor} style={{ fontWeight: 600, fontSize: '0.9rem' }}>
            {session}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>Local</span>
          <span style={{ fontWeight: 500, fontSize: '0.85rem' }}>
            {now.toLocaleTimeString('en-US', { hour12: false })}
          </span>
        </div>
      </div>
    </div>
  );
}
