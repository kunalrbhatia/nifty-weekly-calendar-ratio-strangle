import { WebSocketV2 } from 'smartapi-javascript';
import { getSession } from './api.js';
import { env } from '../config/env.js';
import { isPaperMode } from './modeManager.js';
import { loadStore } from '../store/index.js';

let wsClient: any = null;
let tickCallbacks: ((tick: any) => void)[] = [];
let paperInterval: NodeJS.Timeout | null = null;

export function addTickListener(cb: (tick: any) => void) {
  tickCallbacks.push(cb);
}

export function clearTickListeners() {
  tickCallbacks = [];
}

function dispatchTick(tick: any) {
  for (const cb of tickCallbacks) {
    try {
      cb(tick);
    } catch (err) {
      console.error('Error in tick callback:', err);
    }
  }
}

export async function connectWebSocket(tokens: string[]): Promise<void> {
  if (isPaperMode()) {
    console.log('✓ [PAPER] Connecting mock WebSocket...');
    startPaperTicker(tokens);
    return;
  }

  const session = getSession();
  if (!session?.jwtToken) {
    throw new Error(
      'WebSocket connection failed: No JWT token in session. Make sure to login first.'
    );
  }

  wsClient = new WebSocketV2({
    jwttoken: session.jwtToken,
    apikey: env.API_KEY,
    clientcode: env.CLIENT_CODE,
    feedtype: 'market_feed',
  });

  await wsClient.connect();
  console.log('✓ WebSocket connected');

  // Mode 1: LTP, Exchange Type 1: NSE (for Nifty spot index is 1, NFO option contracts also exchange type 1 or 2? Let's check: usually NFO is exchangeType 2 or NSE/NFO)
  // Let's subscribe to both exchangeType 1 (NSE) and 2 (NFO) depending on token.
  // Spot token 99926000 is on exchange 1 (NSE). Option contracts are on NFO (typically exchangeType 2).
  const nseTokens = tokens.filter((t) => t === '99926000');
  const nfoTokens = tokens.filter((t) => t !== '99926000');

  if (nseTokens.length > 0) {
    wsClient.fetchData({
      correlationID: 'nse_stream',
      action: 1, // Subscribe
      mode: 1, // LTP
      exchangeType: 1, // NSE
      tokens: nseTokens,
    });
  }

  if (nfoTokens.length > 0) {
    wsClient.fetchData({
      correlationID: 'nfo_stream',
      action: 1, // Subscribe
      mode: 1, // LTP
      exchangeType: 2, // NFO
      tokens: nfoTokens,
    });
  }

  wsClient.on('tick', (data: any) => {
    // Standardize tick structure: { token, ltp }
    // The smartapi-javascript returns ticks which might have different keys based on mode.
    // Standard LTP keys: data.token, data.last_traded_price
    if (data) {
      const token = data.token || data.symboltoken;
      const ltp = parseFloat(data.last_traded_price || data.ltp || '0');
      if (token && ltp > 0) {
        dispatchTick({ token, ltp });
      }
    }
  });

  wsClient.on('error', (err: any) => {
    console.error('WebSocket error:', err);
  });

  wsClient.on('close', () => {
    console.log('WebSocket connection closed.');
  });
}

export function disconnectWebSocket() {
  if (isPaperMode()) {
    stopPaperTicker();
    return;
  }
  if (wsClient) {
    try {
      wsClient.close();
    } catch (err) {
      console.error('Failed to close websocket:', err);
    }
    wsClient = null;
  }
}

// Paper/mock trading tick generator
function startPaperTicker(tokens: string[]) {
  stopPaperTicker();

  let currentSpot = 24500;
  // Let's store current prices for other tokens
  const prices: Record<string, number> = {};

  // Set default initial prices
  for (const t of tokens) {
    if (t === '99926000') {
      prices[t] = currentSpot;
    } else {
      // Option premium estimation
      prices[t] = 80; // default premium
    }
  }

  paperInterval = setInterval(() => {
    // Generate minor walk on spot price
    const change = (Math.random() - 0.5) * 10;
    currentSpot += change;

    // Dispatch spot tick
    dispatchTick({ token: '99926000', ltp: currentSpot });

    // Generate walkthrough on option premiums based on spot change
    // If spot goes up: CE premiums go up, PE premiums go down
    const store = loadStore();
    for (const t of tokens) {
      if (t === '99926000') continue;

      const leg = store.legs.find((l) => l.token === t);
      if (leg) {
        let direction = 1;
        if (leg.optionType === 'PE') direction = -1;

        // Option delta approximation: 0.3 for OTM/ratio legs
        const premiumChange = change * 0.3 * direction;
        let currentPremium = prices[t] || leg.fillPremium;
        currentPremium += premiumChange;
        if (currentPremium < 1) currentPremium = 1; // cannot be negative
        prices[t] = currentPremium;
        dispatchTick({ token: t, ltp: currentPremium });
      } else {
        // Default random walk
        let currentPremium = prices[t] || 80;
        currentPremium += (Math.random() - 0.5) * 2;
        if (currentPremium < 1) currentPremium = 1;
        prices[t] = currentPremium;
        dispatchTick({ token: t, ltp: currentPremium });
      }
    }
  }, 2000); // tick every 2 seconds in paper mode for snappy UI/testing
}

function stopPaperTicker() {
  if (paperInterval) {
    clearInterval(paperInterval);
    paperInterval = null;
  }
}
