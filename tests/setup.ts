/**
 * Global test setup
 * Runs before all tests
 */

// Set environment variables for testing
process.env.NODE_ENV = 'test';
process.env.SIMULATION_MODE = 'true';
process.env.BINANCE_TESTNET = 'true';
process.env.BINANCE_API_KEY = 'test_api_key';
process.env.BINANCE_API_SECRET = 'test_api_secret';
process.env.LOG_LEVEL = 'error'; // Reduce noise in tests

// Mock console methods to reduce test output
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Increase test timeout for integration tests
jest.setTimeout(10000);
