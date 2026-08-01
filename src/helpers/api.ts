import { SmartAPI } from 'smartapi-javascript';
import axios from 'axios';
import { env } from '../config/env.js';
import { sendAlert } from '../notifier.js';
import { isPaperMode } from './modeManager.js';

let sessionData: any = null;
let smartApiInstance: SmartAPI | null = null;

// Default headers for direct axios requests (e.g. RMS limit)
const localIp = '192.168.1.1';
const publicIp = '103.241.12.1';
const macAddress = '00-B0-D0-63-C2-26';

export async function getSmartApi(): Promise<SmartAPI> {
  if (!smartApiInstance) {
    smartApiInstance = new SmartAPI({
      api_key: env.API_KEY,
    });
  }
  return smartApiInstance;
}

export async function setSession(data: any) {
  sessionData = data;
  // Authenticate the SDK instance with the JWT token so data calls work
  if (data?.jwtToken) {
    const api = await getSmartApi();
    api.setAccessToken(data.jwtToken);
  }
}

export function getSession() {
  return sessionData;
}

// Retries an idempotent async task
export async function retryCall<T>(
  task: () => Promise<T>,
  label: string,
  retries = 3,
  delayMs = 1000
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await task();
    } catch (err: any) {
      attempt++;
      if (attempt >= retries) {
        const errorMsg = `🚨 Idempotent API failure: ${label} (attempt ${attempt}/${retries}). Error: ${err?.message || err}`;
        await sendAlert(errorMsg);
        throw err;
      }
      console.warn(
        `[RETRY] ${label} failed. Retrying in ${delayMs}ms... (attempt ${attempt}/${retries})`
      );
      await new Promise((res) => setTimeout(res, delayMs));
    }
  }
}

// Fetch Nifty Spot LTP
export async function getNiftySpotLTP(): Promise<number> {
  if (isPaperMode()) {
    // In paper mode, return a mocked Nifty price or fetch from real API if credentials allow.
    // Let's try real API first, if it fails return mock.
    try {
      return await getRealNiftySpotLTP();
    } catch (err) {
      console.warn('Paper mode fallback: using mock Nifty LTP 24500');
      return 24500;
    }
  }
  return getRealNiftySpotLTP();
}

async function getRealNiftySpotLTP(): Promise<number> {
  const api = await getSmartApi();
  // Use the SDK's marketData method with NIFTY 50 index token on NSE
  const task = async () => {
    const res = await api.marketData({
      mode: 'LTP',
      exchangeTokens: {
        NSE: ['99926000'],
      },
    });
    if (res.status && res.data?.fetched?.length > 0) {
      return parseFloat(res.data.fetched[0].ltp);
    }
    throw new Error(res.message || 'marketData returned empty for Nifty spot');
  };
  return retryCall(task, 'Nifty Spot LTP Fetch');
}

// Fetch RMS Utilised Margin
export async function getUtilisedMargin(): Promise<number> {
  if (isPaperMode()) {
    // Standard mock value for paper trading margin
    return 150000;
  }

  const task = async () => {
    if (!sessionData?.jwtToken) {
      throw new Error('Not logged in: session JWT token missing');
    }

    // Direct REST API getRMS call as per API docs
    const url = 'https://apiconnect.angelone.in/rest/secure/angelbroking/user/v1/getRMS';
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${sessionData.jwtToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-UserType': 'USER',
        'X-SourceID': 'WEB',
        'X-ClientLocalIP': localIp,
        'X-ClientPublicIP': publicIp,
        'X-MACAddress': macAddress,
        'X-PrivateKey': env.API_KEY,
      },
      timeout: 5000,
    });

    if (response.data?.status && response.data?.data) {
      // The utilised margin is usually under data.net or data.utilisedDebits/netMargin
      // Let's parse utilised margin or net margin.
      const data = response.data.data;
      const utilised = parseFloat(data.utilisedDebits || data.net || '0');
      return utilised;
    }
    throw new Error(response.data?.message || 'getRMS API returned empty/failed status');
  };

  try {
    return await retryCall(task, 'Fetch RMS Utilised Margin');
  } catch (err: any) {
    // Rule 2.2: Fallback values are a production incident waiting to happen — never let them be silent.
    // Trigger alert every time used, visually distinguishable.
    const fallbackValue = 200000;
    await sendAlert(
      `🚨 CRITICAL: Margin API failed after retries. Using fallback margin value ₹${fallbackValue} (fallback).`
    );
    return fallbackValue;
  }
}

export async function getBulkLTP(
  exchange: 'NSE' | 'NFO',
  tokens: string[]
): Promise<Record<string, number>> {
  if (tokens.length === 0) return {};

  if (isPaperMode()) {
    // In paper mode, we mock the premiums
    const mockData: Record<string, number> = {};
    for (const t of tokens) {
      // Mock option premium between 10 and 200 depending on token digits or random
      mockData[t] = 80 + (parseInt(t, 10) % 50);
    }
    return mockData;
  }

  const api = await getSmartApi();

  const task = async () => {
    // Use the getMarketData method from SDK
    // The request format expected by SDK: { mode: 'LTP', exchangeTokens: { NFO: [...] } }
    const payload = {
      mode: 'LTP',
      exchangeTokens: {
        [exchange]: tokens,
      },
    };
    const res = await api.marketData(payload);

    const results: Record<string, number> = {};
    if (res.status && res.data && Array.isArray(res.data.fetched)) {
      for (const item of res.data.fetched) {
        if (item.symbolToken && item.ltp) {
          results[item.symbolToken] = parseFloat(item.ltp);
        }
      }
      return results;
    }
    throw new Error(res.message || 'getMarketData returned empty or failed status');
  };

  return retryCall(task, `Bulk LTP Fetch for ${tokens.length} tokens`);
}
