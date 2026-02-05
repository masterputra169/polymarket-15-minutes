import { useState, useEffect, useRef, useCallback } from 'react';
import { CONFIG } from '../config.js';

export function useBinanceStream() {
  const [price, setPrice] = useState(null);
  const [prevPrice, setPrevPrice] = useState(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);
  const reconnectMsRef = useRef(500);

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState <= 1) return;

    try {
      const ws = new WebSocket(CONFIG.binanceWsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        reconnectMsRef.current = 500;
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          const p = Number(msg.p);
          if (Number.isFinite(p)) {
            setPrice((prev) => {
              setPrevPrice(prev);
              return p;
            });
          }
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
