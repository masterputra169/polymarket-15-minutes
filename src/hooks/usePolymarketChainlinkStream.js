import { useState, useEffect, useRef, useCallback } from 'react';
import { CONFIG } from '../config.js';

export function usePolymarketChainlinkStream() {
  const [price, setPrice] = useState(null);
  const [prevPrice, setPrevPrice] = useState(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);
  const reconnectMsRef = useRef(500);

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState <= 1) return;

    try {
      const ws = new WebSocket(CONFIG.polymarket.liveDataWsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        reconnectMsRef.current = 500;
        try {
          ws.send(
            JSON.stringify({
              action: 'subscribe',
              subscriptions: [{ topic: 'crypto_prices_chainlink', type: '*', filters: '' }],
            })
          );
        } catch {
          /* ignore */
        }
      };

      ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          if (!data || data.topic !== 'crypto_prices_chainlink') return;

          const payload =
            typeof data.payload === 'string' ? JSON.parse(data.payload) : data.payload || {};
          const symbol = String(
            payload.symbol || payload.pair || payload.ticker || ''
          ).toLowerCase();
          if (!symbol.includes('btc')) return;

          const p = Number(payload.value ?? payload.price ?? payload.current ?? payload.data);
          if (!Number.isFinite(p)) return;

          setPrice((prev) => {
            setPrevPrice(prev);
            return p;
          });
        } catch {
          /* ignore */
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        const wait = reconnectMsRef.current;
        reconnectMsRef.current = Math.min(10000, Math.floor(wait * 1.5));
        reconnectRef.current = setTimeout(connect, wait);
      };

      ws.onerror = () => {
        try { ws.close(); } catch { /* ignore */ }
      };
    } catch {
      const wait = reconnectMsRef.current;
      reconnectMsRef.current = Math.min(10000, Math.floor(wait * 1.5));
      reconnectRef.current = setTimeout(connect, wait);
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectRef.current);
      try { wsRef.current?.close(); } catch { /* ignore */ }
    };
  }, [connect]);

  return { price, prevPrice, connected };
}
