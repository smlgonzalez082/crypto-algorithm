import { WebServer } from "./web/server.js";
import { createLogger } from "./utils/logger.js";
import { tradingDb } from "./models/database.js";

const logger = createLogger("main");

// Debug: Log all process events
logger.info({ pid: process.pid }, "Process starting with PID");

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

// Track process lifecycle events
process.on("exit", (code) => {
  // Note: Cannot use async operations here
  console.error(`[EXIT EVENT] Process exiting with code: ${code}`);
});

process.on("beforeExit", (code) => {
  logger.warn({ code }, "beforeExit event fired - event loop is empty!");
});

process.on("warning", (warning) => {
  logger.warn(
    { warning: warning.message, stack: warning.stack },
    "Process warning",
  );
});

async function main(): Promise<void> {
  logger.info("Starting Crypto Grid Trading Bot...");

  const server = new WebServer();

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(
      { signal, pid: process.pid },
      "Received shutdown signal - starting cleanup",
    );
    try {
      logger.info("Stopping web server...");
      await server.stop();
      logger.info("Web server stopped");

      logger.info("Closing database...");
      tradingDb.close();
      logger.info("Database closed");

      logger.info("Server and database stopped gracefully");
      process.exit(0);
    } catch (error) {
      logger.error({ error }, "Error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGINT", () => {
    logger.warn("SIGINT received (Ctrl+C)");
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    logger.warn("SIGTERM received");
    void shutdown("SIGTERM");
  });
  process.on("SIGHUP", () => {
    logger.warn("SIGHUP received");
    void shutdown("SIGHUP");
  });

  try {
    await server.start();
    logger.info("Server started successfully, entering event loop");

    // Heartbeat to prove process is alive
    let heartbeatCount = 0;
    setInterval(() => {
      heartbeatCount++;
      logger.info(
        { heartbeat: heartbeatCount, uptime: process.uptime() },
        "Process alive - heartbeat",
      );
    }, 10000); // Every 10 seconds
  } catch (error) {
    logger.error({ error }, "Failed to start server");
    process.exit(1);
  }
}

void main();
