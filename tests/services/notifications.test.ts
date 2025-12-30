/**
 * Notifications Service Tests
 */

import { jest } from '@jest/globals';
import { NotificationService } from '../../src/services/notifications.js';
import type { Alert } from '../../src/services/notifications.js';

jest.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

// Mock global fetch
global.fetch = jest.fn() as jest.Mock;

describe('NotificationService', () => {
  let notificationService: NotificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
    });
  });

  describe('Initialization', () => {
    it('should initialize with environment config', () => {
      const service = new NotificationService();
      expect(service).toBeDefined();
    });

    it('should initialize with custom config', () => {
      const service = new NotificationService({
        discordWebhookUrl: 'https://discord.com/webhook/test',
        emailEnabled: true,
        emailTo: 'test@example.com',
        emailApiKey: 'test-key',
      });

      expect(service).toBeDefined();
    });

    it('should disable when no valid config provided', () => {
      const service = new NotificationService({});
      expect(service).toBeDefined();
    });
  });

  describe('sendAlert', () => {
    it('should send alert to Discord', async () => {
      const service = new NotificationService({
        discordWebhookUrl: 'https://discord.com/webhook/test',
      });

      const alert: Alert = {
        level: 'INFO',
        title: 'Test Alert',
        message: 'This is a test',
        timestamp: new Date(),
      };

      await service.sendAlert(alert);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://discord.com/webhook/test',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('should send alert to Email', async () => {
      const service = new NotificationService({
        emailEnabled: true,
        emailTo: 'test@example.com',
        emailApiKey: 'test-key',
      });

      const alert: Alert = {
        level: 'WARNING',
        title: 'Test Warning',
        message: 'This is a warning',
        timestamp: new Date(),
      };

      await service.sendAlert(alert);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.sendgrid.com/v3/mail/send',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should send alert to Slack', async () => {
      const service = new NotificationService({
        slackWebhookUrl: 'https://hooks.slack.com/services/test',
      });

      const alert: Alert = {
        level: 'CRITICAL',
        title: 'Critical Alert',
        message: 'System failure',
        timestamp: new Date(),
      };

      await service.sendAlert(alert);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/services/test',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should include metadata in alert', async () => {
      const service = new NotificationService({
        discordWebhookUrl: 'https://discord.com/webhook/test',
      });

      const alert: Alert = {
        level: 'SUCCESS',
        title: 'Trade Executed',
        message: 'Successfully executed trade',
        timestamp: new Date(),
        metadata: {
          symbol: 'DOGEUSDT',
          price: 0.14,
          quantity: 100,
        },
      };

      await service.sendAlert(alert);

      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.embeds[0].fields).toBeDefined();
      expect(body.embeds[0].fields.length).toBe(3);
    });

    it('should handle fetch errors gracefully', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      const service = new NotificationService({
        discordWebhookUrl: 'https://discord.com/webhook/test',
      });

      const alert: Alert = {
        level: 'INFO',
        title: 'Test',
        message: 'Test',
        timestamp: new Date(),
      };

      await expect(service.sendAlert(alert)).resolves.not.toThrow();
    });
  });

  describe('Convenience Methods', () => {
    beforeEach(() => {
      notificationService = new NotificationService({
        discordWebhookUrl: 'https://discord.com/webhook/test',
      });
    });

    it('should send critical alert', async () => {
      await notificationService.critical('Critical', 'Critical message');

      expect(global.fetch).toHaveBeenCalled();
      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.embeds[0].title).toContain('Critical');
      expect(body.embeds[0].color).toBe(0xff0000); // Red
    });

    it('should send warning alert', async () => {
      await notificationService.warning('Warning', 'Warning message');

      expect(global.fetch).toHaveBeenCalled();
      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.embeds[0].title).toContain('Warning');
      expect(body.embeds[0].color).toBe(0xffa500); // Orange
    });

    it('should send info alert', async () => {
      await notificationService.info('Info', 'Info message');

      expect(global.fetch).toHaveBeenCalled();
      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.embeds[0].title).toContain('Info');
      expect(body.embeds[0].color).toBe(0x3498db); // Blue
    });

    it('should send success alert', async () => {
      await notificationService.success('Success', 'Success message');

      expect(global.fetch).toHaveBeenCalled();
      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.embeds[0].title).toContain('Success');
      expect(body.embeds[0].color).toBe(0x00ff00); // Green
    });

    it('should include metadata in convenience methods', async () => {
      await notificationService.success('Trade Complete', 'Trade executed successfully', {
        symbol: 'DOGEUSDT',
        profit: 10.50,
      });

      expect(global.fetch).toHaveBeenCalled();
      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.embeds[0].fields.length).toBe(2);
    });
  });

  describe('Multiple Channels', () => {
    it('should send to all configured channels', async () => {
      const service = new NotificationService({
        discordWebhookUrl: 'https://discord.com/webhook/test',
        emailEnabled: true,
        emailTo: 'test@example.com',
        emailApiKey: 'test-key',
        slackWebhookUrl: 'https://hooks.slack.com/services/test',
      });

      const alert: Alert = {
        level: 'INFO',
        title: 'Multi-channel Test',
        message: 'Testing all channels',
        timestamp: new Date(),
      };

      await service.sendAlert(alert);

      // Should make 3 fetch calls (Discord, Email, Slack)
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });
  });
});
