/**
 * Notification Service for Critical Bot Events
 * Supports Discord, Email (SendGrid), and Slack webhooks
 */

import { createLogger } from "../utils/logger.js";

const logger = createLogger("notifications");

export type AlertLevel = "CRITICAL" | "WARNING" | "INFO" | "SUCCESS";

export interface NotificationConfig {
  discordWebhookUrl?: string;
  emailEnabled?: boolean;
  emailTo?: string;
  emailApiKey?: string; // SendGrid API key
  slackWebhookUrl?: string;
}

export interface Alert {
  level: AlertLevel;
  title: string;
  message: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Notification Service for sending alerts through multiple channels
 */
export class NotificationService {
  private config: NotificationConfig;
  private enabled: boolean = false;

  constructor(notificationConfig?: NotificationConfig) {
    this.config = notificationConfig || this.loadConfigFromEnv();
    this.enabled = this.hasValidConfig();

    if (this.enabled) {
      logger.info(
        {
          discord: !!this.config.discordWebhookUrl,
          email: !!this.config.emailEnabled,
          slack: !!this.config.slackWebhookUrl,
        },
        "Notification service initialized",
      );
    } else {
      logger.warn(
        "Notification service disabled - no valid configuration found",
      );
    }
  }

  /**
   * Load notification config from environment variables
   */
  private loadConfigFromEnv(): NotificationConfig {
    return {
      discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL,
      emailEnabled: process.env.EMAIL_ENABLED === "true",
      emailTo: process.env.ALERT_EMAIL,
      emailApiKey: process.env.SENDGRID_API_KEY,
      slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
    };
  }

  /**
   * Check if at least one notification channel is configured
   */
  private hasValidConfig(): boolean {
    return !!(
      this.config.discordWebhookUrl ||
      (this.config.emailEnabled &&
        this.config.emailTo &&
        this.config.emailApiKey) ||
      this.config.slackWebhookUrl
    );
  }

  /**
   * Send an alert through all configured channels
   */
  async sendAlert(alert: Alert): Promise<void> {
    if (!this.enabled) {
      logger.debug({ alert }, "Notification service disabled, skipping alert");
      return;
    }

    const promises: Promise<void>[] = [];

    // Discord
    if (this.config.discordWebhookUrl) {
      promises.push(this.sendDiscordAlert(alert));
    }

    // Email
    if (
      this.config.emailEnabled &&
      this.config.emailTo &&
      this.config.emailApiKey
    ) {
      promises.push(this.sendEmailAlert(alert));
    }

    // Slack
    if (this.config.slackWebhookUrl) {
      promises.push(this.sendSlackAlert(alert));
    }

    try {
      await Promise.allSettled(promises);
      logger.info(
        { level: alert.level, title: alert.title },
        "Alert sent to all channels",
      );
    } catch (error) {
      logger.error({ error, alert }, "Failed to send alert");
    }
  }

  /**
   * Send alert to Discord via webhook
   */
  private async sendDiscordAlert(alert: Alert): Promise<void> {
    if (!this.config.discordWebhookUrl) return;

    const color = this.getColorForLevel(alert.level);
    const emoji = this.getEmojiForLevel(alert.level);

    const embed = {
      embeds: [
        {
          title: `${emoji} ${alert.title}`,
          description: alert.message,
          color: color,
          timestamp: alert.timestamp.toISOString(),
          fields: alert.metadata
            ? Object.entries(alert.metadata).map(([key, value]) => ({
                name: key,
                value: String(value),
                inline: true,
              }))
            : [],
        },
      ],
    };

    try {
      const response = await fetch(this.config.discordWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(embed),
      });

      if (!response.ok) {
        throw new Error(`Discord webhook failed: ${response.statusText}`);
      }

      logger.debug({ title: alert.title }, "Discord alert sent");
    } catch (error) {
      logger.error({ error, alert }, "Failed to send Discord alert");
      throw error;
    }
  }

  /**
   * Send alert via email using SendGrid
   */
  private async sendEmailAlert(alert: Alert): Promise<void> {
    if (!this.config.emailApiKey || !this.config.emailTo) return;

    const emailData = {
      personalizations: [
        {
          to: [{ email: this.config.emailTo }],
          subject: `[Crypto Bot ${alert.level}] ${alert.title}`,
        },
      ],
      from: { email: "noreply@cryptobot.com", name: "Crypto Grid Trading Bot" },
      content: [
        {
          type: "text/html",
          value: this.formatEmailHtml(alert),
        },
      ],
    };

    try {
      const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.emailApiKey}`,
        },
        body: JSON.stringify(emailData),
      });

      if (!response.ok) {
        throw new Error(`SendGrid API failed: ${response.statusText}`);
      }

      logger.debug({ title: alert.title }, "Email alert sent");
    } catch (error) {
      logger.error({ error, alert }, "Failed to send email alert");
      throw error;
    }
  }

  /**
   * Send alert to Slack via webhook
   */
  private async sendSlackAlert(alert: Alert): Promise<void> {
    if (!this.config.slackWebhookUrl) return;

    const emoji = this.getEmojiForLevel(alert.level);
    const color = this.getSlackColorForLevel(alert.level);

    const payload = {
      attachments: [
        {
          color: color,
          title: `${emoji} ${alert.title}`,
          text: alert.message,
          ts: Math.floor(alert.timestamp.getTime() / 1000),
          fields: alert.metadata
            ? Object.entries(alert.metadata).map(([key, value]) => ({
                title: key,
                value: String(value),
                short: true,
              }))
            : [],
        },
      ],
    };

    try {
      const response = await fetch(this.config.slackWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Slack webhook failed: ${response.statusText}`);
      }

      logger.debug({ title: alert.title }, "Slack alert sent");
    } catch (error) {
      logger.error({ error, alert }, "Failed to send Slack alert");
      throw error;
    }
  }

  /**
   * Format email HTML
   */
  private formatEmailHtml(alert: Alert): string {
    const emoji = this.getEmojiForLevel(alert.level);
    const color = this.getHtmlColorForLevel(alert.level);

    let metadataHtml = "";
    if (alert.metadata) {
      metadataHtml = "<h3>Details:</h3><ul>";
      for (const [key, value] of Object.entries(alert.metadata)) {
        metadataHtml += `<li><strong>${key}:</strong> ${String(value)}</li>`;
      }
      metadataHtml += "</ul>";
    }

    return `
      <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: ${color}; color: white; padding: 20px; border-radius: 5px 5px 0 0;">
            <h2>${emoji} ${alert.title}</h2>
          </div>
          <div style="padding: 20px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 5px 5px;">
            <p>${alert.message}</p>
            ${metadataHtml}
            <p style="color: #888; font-size: 12px; margin-top: 20px;">
              Time: ${alert.timestamp.toLocaleString()}<br>
              Crypto Grid Trading Bot
            </p>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Get Discord color for alert level
   */
  private getColorForLevel(level: AlertLevel): number {
    switch (level) {
      case "CRITICAL":
        return 0xff0000; // Red
      case "WARNING":
        return 0xffa500; // Orange
      case "INFO":
        return 0x3498db; // Blue
      case "SUCCESS":
        return 0x00ff00; // Green
      default:
        return 0x808080; // Gray
    }
  }

  /**
   * Get Slack color for alert level
   */
  private getSlackColorForLevel(level: AlertLevel): string {
    switch (level) {
      case "CRITICAL":
        return "danger";
      case "WARNING":
        return "warning";
      case "SUCCESS":
        return "good";
      case "INFO":
      default:
        return "#3498db";
    }
  }

  /**
   * Get HTML color for alert level
   */
  private getHtmlColorForLevel(level: AlertLevel): string {
    switch (level) {
      case "CRITICAL":
        return "#dc3545";
      case "WARNING":
        return "#ffc107";
      case "SUCCESS":
        return "#28a745";
      case "INFO":
      default:
        return "#007bff";
    }
  }

  /**
   * Get emoji for alert level
   */
  private getEmojiForLevel(level: AlertLevel): string {
    switch (level) {
      case "CRITICAL":
        return "🚨";
      case "WARNING":
        return "⚠️";
      case "SUCCESS":
        return "✅";
      case "INFO":
      default:
        return "ℹ️";
    }
  }

  /**
   * Convenience methods for different alert levels
   */
  async critical(
    title: string,
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.sendAlert({
      level: "CRITICAL",
      title,
      message,
      timestamp: new Date(),
      metadata,
    });
  }

  async warning(
    title: string,
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.sendAlert({
      level: "WARNING",
      title,
      message,
      timestamp: new Date(),
      metadata,
    });
  }

  async info(
    title: string,
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.sendAlert({
      level: "INFO",
      title,
      message,
      timestamp: new Date(),
      metadata,
    });
  }

  async success(
    title: string,
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.sendAlert({
      level: "SUCCESS",
      title,
      message,
      timestamp: new Date(),
      metadata,
    });
  }
}

// Singleton instance
export const notificationService = new NotificationService();
