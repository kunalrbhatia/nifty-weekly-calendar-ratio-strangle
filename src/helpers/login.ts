import { authenticator } from 'otplib';
import { env } from '../config/env.js';
import { getSmartApi, setSession, retryCall } from './api.js';
import { isPaperMode } from './modeManager.js';

export async function loginToBroker(): Promise<boolean> {
  if (isPaperMode()) {
    console.log('✓ Paper mode active: Mock login successful');
    setSession({
      jwtToken: 'mock-jwt-token',
      refreshToken: 'mock-refresh-token',
      feedToken: 'mock-feed-token',
    });
    return true;
  }

  const api = await getSmartApi();
  const totp = authenticator.generate(env.CLIENT_TOTP_PIN);

  const task = async () => {
    // Generate session using Client Code, password/pin, and totp
    const res = await api.generateSession(env.CLIENT_CODE, env.CLIENT_PIN, totp);
    if (res.status && res.data) {
      setSession(res.data);
      console.log('✓ Login successful');
      return true;
    }
    throw new Error(res.message || 'Login failed with empty response');
  };

  try {
    await retryCall(task, 'Broker Login', 3, 2000);
    return true;
  } catch (err) {
    console.error('❌ Failed to login to broker:', err);
    return false;
  }
}
