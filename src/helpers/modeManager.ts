import fs from 'fs';
import path from 'path';

const ROOT_DIR = process.cwd();

export function isPaperMode(): boolean {
  return fs.existsSync(path.join(ROOT_DIR, '.paper'));
}

export function isKillSwitchActive(): boolean {
  return fs.existsSync(path.join(ROOT_DIR, '.kill'));
}

export function isPanicSwitchActive(): boolean {
  return fs.existsSync(path.join(ROOT_DIR, '.panic'));
}
