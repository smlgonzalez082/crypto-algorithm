import { pino, type Logger } from "pino";
import { config } from "./config.js";

const isDevelopment = process.env.NODE_ENV !== "production";

export const logger: Logger = pino({
  level: isDevelopment ? config.logLevel : "info",
  // Only use pino-pretty in development for performance
  ...(isDevelopment
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        },
      }
    : {
        // Production: JSON output for log aggregation
        formatters: {
          level: (label) => {
            return { level: label };
          },
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      }),
  // Redact sensitive data in logs
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'res.headers["set-cookie"]',
      "password",
      "apiKey",
      "apiSecret",
      "secret",
      "token",
      "binanceApiKey",
      "binanceApiSecret",
    ],
    remove: true,
  },
});

export function createLogger(name: string): Logger {
  return logger.child({ module: name });
}

export default logger;
