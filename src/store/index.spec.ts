import fs from 'fs';
import { loadStore, saveStore, clearStore, initStore } from './index.js';

jest.mock('fs');

describe('store', () => {
  const mockExistsSync = fs.existsSync as jest.Mock;
  const mockReadFileSync = fs.readFileSync as jest.Mock;
  const mockWriteFileSync = fs.writeFileSync as jest.Mock;
  const mockMkdirSync = fs.mkdirSync as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should initialize store file if not exists', () => {
    mockExistsSync.mockReturnValueOnce(false).mockReturnValueOnce(false);
    initStore();
    expect(mockMkdirSync).toHaveBeenCalled();
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  it('should load store successfully', () => {
    mockExistsSync.mockReturnValue(true);
    const mockState = { status: 'FULL_ENTRY', entryMargin: 100000 };
    mockReadFileSync.mockReturnValue(JSON.stringify(mockState));

    const state = loadStore();
    expect(state.status).toBe('FULL_ENTRY');
    expect(state.entryMargin).toBe(100000);
  });

  it('should fallback to default on read failure', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('read error');
    });

    const state = loadStore();
    expect(state.status).toBe('NONE');
  });

  it('should clear store correctly', () => {
    mockExistsSync.mockReturnValue(true);
    clearStore();
    expect(mockWriteFileSync).toHaveBeenCalled();
  });
});
