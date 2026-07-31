import axios from 'axios';
import { sendAlert } from './notifier.js';
import { env } from './config/env.js';

jest.mock('axios');
jest.mock('telegraf', () => {
  return {
    Telegraf: jest.fn().mockImplementation(() => {
      return {
        telegram: {
          sendMessage: jest.fn().mockResolvedValue({}),
        },
      };
    }),
  };
});

describe('notifier', () => {
  const mockPost = axios.post as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should log alert to console', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    await sendAlert('Test Message');
    expect(logSpy).toHaveBeenCalledWith('[ALERT] Test Message');
    logSpy.mockRestore();
  });

  it('should post to Slack if enabled', async () => {
    env.USE_SLACK = true;
    env.SLACK_WEBHOOK_URL = 'http://slack.mock';
    mockPost.mockResolvedValueOnce({ status: 200 });

    await sendAlert('Hello Slack');
    expect(mockPost).toHaveBeenCalledWith(
      'http://slack.mock',
      { text: 'Hello Slack' },
      { timeout: 5000 }
    );
  });
});
