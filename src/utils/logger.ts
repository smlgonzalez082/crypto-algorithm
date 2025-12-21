import { pino, type Logger } from 'pino';
import { config } from './config.js';

export const logger: Logger = pino({
  level: config.logLevel,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  },
});

export function createLogger(name: string): Logger {
  return logger.child({ module: name });
}

export default logger;
