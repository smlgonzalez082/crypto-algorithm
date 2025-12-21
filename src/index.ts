import { WebServer } from "./web/server.js";
import { createLogger } from "./utils/logger.js";

const logger = createLogger("main");

async function main(): Promise<void> {
  logger.info("Starting Crypto Grid Trading Bot...");

  const server = new WebServer();

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Received shutdown signal");
    try {
      await server.stop();
      logger.info("Server stopped gracefully");
      process.exit(0);
    } catch (error) {
      logger.error({ error }, "Error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  try {
    await server.start();
  } catch (error) {
    logger.error({ error }, "Failed to start server");
    process.exit(1);
  }
}

void main();
