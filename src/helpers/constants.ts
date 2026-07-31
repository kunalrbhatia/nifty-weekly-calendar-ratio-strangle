export const INDEX_CONFIGS = {
  NIFTY: {
    symbol: 'NIFTY',
    exchSeg: 'NFO',
    instrumentType: 'OPTIDX',
    defaultLotSize: 65, // Note: dynamically verified and checked. We'll use 65 or 25 depending on exchange info, let's keep it as default config
    strikeStep: 100,
  },
} as const;

export type IndexName = keyof typeof INDEX_CONFIGS;
