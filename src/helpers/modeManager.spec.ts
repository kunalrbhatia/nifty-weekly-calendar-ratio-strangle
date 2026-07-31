import fs from 'fs';
import { isPaperMode, isKillSwitchActive, isPanicSwitchActive } from './modeManager.js';

jest.mock('fs');

describe('modeManager', () => {
  const mockExistsSync = fs.existsSync as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should detect paper mode', () => {
    mockExistsSync.mockReturnValueOnce(true);
    expect(isPaperMode()).toBe(true);

    mockExistsSync.mockReturnValueOnce(false);
    expect(isPaperMode()).toBe(false);
  });

  it('should detect kill switch', () => {
    mockExistsSync.mockReturnValueOnce(true);
    expect(isKillSwitchActive()).toBe(true);

    mockExistsSync.mockReturnValueOnce(false);
    expect(isKillSwitchActive()).toBe(false);
  });

  it('should detect panic switch', () => {
    mockExistsSync.mockReturnValueOnce(true);
    expect(isPanicSwitchActive()).toBe(true);

    mockExistsSync.mockReturnValueOnce(false);
    expect(isPanicSwitchActive()).toBe(false);
  });
});
