import { WebServer } from "./web/server.js";
import { createLogger } from "./utils/logger.js";
import { tradingDb } from "./models/database.js";

const logger = createLogger("main");

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  logger.error({ reason, promise }, "Unhandled Promise Rejection");
  process.exit(1);
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  logger.error({ error }, "Uncaught Exception");
  process.exit(1);
});

async function main(): Promise<void> {
  logger.info("Starting Crypto Grid Trading Bot...");

  const server = new WebServer();

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Received shutdown signal");
    try {
      await server.stop();
      tradingDb.close();
      logger.info("Server and database stopped gracefully");
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
    logger.info("Server started successfully, entering event loop");
  } catch (error) {
    logger.error({ error }, "Failed to start server");
    process.exit(1);
  }
}

void main();
