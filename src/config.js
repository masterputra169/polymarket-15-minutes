export const CONFIG = {
  symbol: 'BTCUSDT',
  binanceWsUrl: 'wss://stream.binance.com:9443/ws/btcusdt@trade',
  binanceBaseUrl: '/binance-api',
  gammaBaseUrl: '/gamma-api',
  clobBaseUrl: '/clob-api',

  pollIntervalMs: 1_000,
  candleWindowMinutes: 15,

  vwapSlopeLookbackMinutes: 5,
  rsiPeriod: 14,
  rsiMaPeriod: 14,

  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,

  polymarket: {
    seriesId: '10192',
    seriesSlug: 'btc-up-or-down-15m',
    autoSelectLatest: true,
    liveDataWsUrl: 'wss://ws-live-data.polymarket.com',
    upOutcomeLabel: 'Up',
    downOutcomeLabel: 'Down',
  },

  chainlink: {
    polygonRpcUrls: [
      'https://polygon-rpc.com',
      'https://rpc.ankr.com/polygon',
      'https://polygon.llamarpc.com',
    ],
    polygonWssUrls: [
      'wss://polygon-bor-rpc.publicnode.com',
    ],
    btcUsdAggregator: '0xc907E116054Ad103354f2D350FD2514433D57F6f',
    decimals: 8,
  },
};
