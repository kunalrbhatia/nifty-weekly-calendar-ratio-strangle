import { reconcileStoreWithBroker } from './reconcile.js';
import { loadStore } from '../store/index.js';
import { isPaperMode } from './modeManager.js';
import { getSmartApi, retryCall } from './api.js';
import { sendAlert } from '../notifier.js';

jest.mock('../store/index.js');
jest.mock('./modeManager.js');
jest.mock('./api.js');
jest.mock('../notifier.js');

describe('reconcileStoreWithBroker', () => {
  const mockLoadStore = loadStore as jest.Mock;
  const mockIsPaperMode = isPaperMode as jest.Mock;
  const mockGetSmartApi = getSmartApi as jest.Mock;
  const mockRetryCall = retryCall as jest.Mock;
  const mockSendAlert = sendAlert as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsPaperMode.mockReturnValue(false);
  });

  // 1. Store status NONE -> ok, no broker call
  it('should return ok: true and zero mismatches when store status is NONE', async () => {
    mockLoadStore.mockReturnValue({ status: 'NONE', legs: [] });

    const res = await reconcileStoreWithBroker();

    expect(res).toEqual({ ok: true, mismatches: [] });
    expect(mockGetSmartApi).not.toHaveBeenCalled();
    expect(mockSendAlert).not.toHaveBeenCalled();
  });

  // 2. Paper mode -> ok, no broker call
  it('should return ok: true and zero mismatches in paper mode', async () => {
    mockLoadStore.mockReturnValue({
      status: 'FULL_ENTRY',
      legs: [
        {
          symbol: 'NIFTY01SEP2624600CE',
          token: '12345',
          side: 'BUY',
          qty: 65,
          status: 'OPEN',
        },
      ],
    });
    mockIsPaperMode.mockReturnValue(true);

    const res = await reconcileStoreWithBroker();

    expect(res).toEqual({ ok: true, mismatches: [] });
    expect(mockGetSmartApi).not.toHaveBeenCalled();
    expect(mockSendAlert).not.toHaveBeenCalled();
  });

  // 3. All legs match broker
  it('should return ok: true when all legs match broker positions', async () => {
    mockLoadStore.mockReturnValue({
      status: 'FULL_ENTRY',
      legs: [
        {
          symbol: 'NIFTY01SEP2624600CE',
          side: 'BUY',
          qty: 65,
          status: 'OPEN',
        },
        {
          symbol: 'NIFTY25AUG2624600CE',
          side: 'SELL',
          qty: 130,
          status: 'OPEN',
        },
      ],
    });

    const mockPositionData = [
      { tradingsymbol: 'NIFTY01SEP2624600CE', netqty: '4225' }, // 65 * 65 = 4225
      { tradingsymbol: 'NIFTY25AUG2624600CE', netqty: '-8450' }, // -130 * 65 = -8450
    ];

    const mockApi = { getPosition: jest.fn() };
    mockGetSmartApi.mockResolvedValue(mockApi);
    mockRetryCall.mockImplementation(async (task: () => Promise<any>) => task());
    mockApi.getPosition.mockResolvedValue({ status: true, data: mockPositionData });

    const res = await reconcileStoreWithBroker();

    expect(res).toEqual({ ok: true, mismatches: [] });
    expect(mockSendAlert).not.toHaveBeenCalled();
  });

  // 4. Leg missing at broker (zero)
  it('should flag mismatch when open leg has zero position at broker', async () => {
    mockLoadStore.mockReturnValue({
      status: 'FULL_ENTRY',
      legs: [
        {
          symbol: 'NIFTY01SEP2624600CE',
          side: 'BUY',
          qty: 65,
          status: 'OPEN',
        },
      ],
    });

    const mockApi = { getPosition: jest.fn() };
    mockGetSmartApi.mockResolvedValue(mockApi);
    mockRetryCall.mockImplementation(async (task: () => Promise<any>) => task());
    mockApi.getPosition.mockResolvedValue({ status: true, data: [] });

    const res = await reconcileStoreWithBroker();

    expect(res.ok).toBe(false);
    expect(res.mismatches.length).toBe(1);
    expect(res.mismatches[0]).toContain('ZERO position');
    expect(mockSendAlert).toHaveBeenCalledTimes(1);
  });

  // 5. Opposite side at broker
  it('should flag mismatch when broker shows opposite side position', async () => {
    mockLoadStore.mockReturnValue({
      status: 'FULL_ENTRY',
      legs: [
        {
          symbol: 'NIFTY01SEP2624600CE',
          side: 'BUY',
          qty: 65,
          status: 'OPEN',
        },
      ],
    });

    const mockPositionData = [
      { tradingsymbol: 'NIFTY01SEP2624600CE', netqty: '-4225' }, // store expected +4225
    ];

    const mockApi = { getPosition: jest.fn() };
    mockGetSmartApi.mockResolvedValue(mockApi);
    mockRetryCall.mockImplementation(async (task: () => Promise<any>) => task());
    mockApi.getPosition.mockResolvedValue({ status: true, data: mockPositionData });

    const res = await reconcileStoreWithBroker();

    expect(res.ok).toBe(false);
    expect(res.mismatches.length).toBe(1);
    expect(res.mismatches[0]).toContain('OPPOSITE side');
    expect(mockSendAlert).toHaveBeenCalledTimes(1);
  });

  // 6. Quantity mismatch
  it('should flag mismatch when broker shows different quantity', async () => {
    mockLoadStore.mockReturnValue({
      status: 'FULL_ENTRY',
      legs: [
        {
          symbol: 'NIFTY25AUG2624600CE',
          side: 'SELL',
          qty: 130,
          status: 'OPEN',
        },
      ],
    });

    const mockPositionData = [
      { tradingsymbol: 'NIFTY25AUG2624600CE', netqty: '-4230' }, // expected -8450
    ];

    const mockApi = { getPosition: jest.fn() };
    mockGetSmartApi.mockResolvedValue(mockApi);
    mockRetryCall.mockImplementation(async (task: () => Promise<any>) => task());
    mockApi.getPosition.mockResolvedValue({ status: true, data: mockPositionData });

    const res = await reconcileStoreWithBroker();

    expect(res.ok).toBe(false);
    expect(res.mismatches.length).toBe(1);
    expect(res.mismatches[0]).toContain('shares');
    expect(mockSendAlert).toHaveBeenCalledTimes(1);
  });

  // 7. getPosition throws
  it('should handle getPosition failure by alerting and returning ok: false', async () => {
    mockLoadStore.mockReturnValue({
      status: 'FULL_ENTRY',
      legs: [
        {
          symbol: 'NIFTY01SEP2624600CE',
          side: 'BUY',
          qty: 65,
          status: 'OPEN',
        },
      ],
    });

    mockRetryCall.mockRejectedValue(new Error('Network error'));

    const res = await reconcileStoreWithBroker();

    expect(res.ok).toBe(false);
    expect(res.mismatches.length).toBe(1);
    expect(res.mismatches[0]).toContain('Could not fetch broker positions: Network error');
    expect(mockSendAlert).toHaveBeenCalledTimes(1);
  });

  // 8. sendAlert called exactly once when mismatches exist, zero times when clean
  it('should call sendAlert exactly once when mismatches exist and zero times when clean', async () => {
    mockLoadStore.mockReturnValue({
      status: 'FULL_ENTRY',
      legs: [
        {
          symbol: 'NIFTY01SEP2624600CE',
          side: 'BUY',
          qty: 65,
          status: 'OPEN',
        },
        {
          symbol: 'NIFTY25AUG2624600CE',
          side: 'SELL',
          qty: 130,
          status: 'OPEN',
        },
      ],
    });

    // Case A: Clean
    const mockPositionDataClean = [
      { tradingsymbol: 'NIFTY01SEP2624600CE', netqty: '4225' },
      { tradingsymbol: 'NIFTY25AUG2624600CE', netqty: '-8450' },
    ];
    const mockApi = { getPosition: jest.fn() };
    mockGetSmartApi.mockResolvedValue(mockApi);
    mockRetryCall.mockImplementation(async (task: () => Promise<any>) => task());
    mockApi.getPosition.mockResolvedValue({ status: true, data: mockPositionDataClean });

    const cleanRes = await reconcileStoreWithBroker();
    expect(cleanRes.ok).toBe(true);
    expect(mockSendAlert).not.toHaveBeenCalled();

    // Case B: Mismatches
    mockApi.getPosition.mockResolvedValue({ status: true, data: [] });
    const mismatchRes = await reconcileStoreWithBroker();
    expect(mismatchRes.ok).toBe(false);
    expect(mockSendAlert).toHaveBeenCalledTimes(1);
  });
});
