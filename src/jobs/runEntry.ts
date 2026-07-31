import { loginToBroker } from '../helpers/login.js';
import { runEntrySequence } from './entry.js';
import { downloadScripMaster, loadCachedScrips } from '../helpers/scripMaster.js';

async function testPlaceOrder() {
  console.log('[TEST] Starting manual entry sequence check...');

  const loggedIn = await loginToBroker();
  if (!loggedIn) {
    console.error('[TEST] Failed to log in. Exiting.');
    process.exit(1);
  }

  // Ensure scrip master is loaded
  const scrips = loadCachedScrips();
  if (scrips.length === 0) {
    console.log('[TEST] Scrips cache empty. Fetching...');
    try {
      await downloadScripMaster();
    } catch (err: any) {
      console.error('[TEST] Failed to download scrip master:', err.message);
      process.exit(1);
    }
  }

  try {
    await runEntrySequence();
    console.log('[TEST] Entry sequence completed.');
  } catch (err: any) {
    console.error('[TEST] Entry sequence failed:', err.message);
  }
}

testPlaceOrder();
