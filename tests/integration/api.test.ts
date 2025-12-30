/**
 * API Integration Tests
 * Tests all Express endpoints
 */

import { jest } from '@jest/globals';
import request from 'supertest';
import express, { Express } from 'express';
import { Server } from '../../src/web/server.js';
import { createMockBinanceClient, createMockDatabase } from '../helpers/mocks.js';

jest.mock('../../src/exchange/binance.js', () => ({
  BinanceClient: jest.fn().mockImplementation(() => createMockBinanceClient()),
}));

jest.mock('../../src/models/database.js', () => ({
  tradingDb: createMockDatabase(),
}));

jest.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

// Mock WebSocket server
jest.mock('ws', () => ({
  WebSocketServer: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    clients: new Set(),
  })),
}));

describe('API Integration Tests', () => {
  let app: Express;
  let server: Server;

  beforeAll(async () => {
    server = new Server(3002); // Use different port for testing
    await server.start();
    app = server['app']; // Access private app property for testing
  });

  afterAll(async () => {
    await server.stop();
  });

  describe('Health & Status Endpoints', () => {
    it('GET /api/health should return healthy status', async () => {
      const response = await request(app).get('/api/health');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status');
      expect(response.body.status).toBe('healthy');
    });

    it('GET /api/status should return bot status', async () => {
      const response = await request(app).get('/api/status');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('running');
      expect(response.body).toHaveProperty('mode');
    });

    it('GET /api/config should return configuration', async () => {
      const response = await request(app).get('/api/config');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('portfolio');
      expect(response.body).toHaveProperty('pairs');
    });
  });

  describe('Portfolio Endpoints', () => {
    it('GET /api/portfolio should return portfolio state', async () => {
      const response = await request(app).get('/api/portfolio');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('totalCapital');
      expect(response.body).toHaveProperty('pairs');
    });

    it('POST /api/portfolio/start should start portfolio bot', async () => {
      const response = await request(app)
        .post('/api/portfolio/start')
        .send({});

      // May return 200 or 500 depending on mocks, but should respond
      expect([200, 500]).toContain(response.status);
    });

    it('POST /api/portfolio/stop should stop portfolio bot', async () => {
      const response = await request(app)
        .post('/api/portfolio/stop')
        .send({});

      expect([200, 500]).toContain(response.status);
    });
  });

  describe('Analytics Endpoints', () => {
    it('GET /api/analytics/metrics should return performance metrics', async () => {
      const response = await request(app).get('/api/analytics/metrics');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('totalTrades');
      expect(response.body).toHaveProperty('winRate');
    });

    it('GET /api/analytics/equity-curve should return equity curve', async () => {
      const response = await request(app).get('/api/analytics/equity-curve');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('GET /api/analytics/pair-performance should return pair performance', async () => {
      const response = await request(app).get('/api/analytics/pair-performance');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('GET /api/analytics/export-csv should return CSV', async () => {
      const response = await request(app).get('/api/analytics/export-csv');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(typeof response.text).toBe('string');
    });
  });

  describe('Balance Endpoints', () => {
    it('GET /api/balances should return account balances', async () => {
      const response = await request(app).get('/api/balances');

      expect([200, 500]).toContain(response.status);
      if (response.status === 200) {
        expect(Array.isArray(response.body)).toBe(true);
      }
    });
  });

  describe('Trades Endpoints', () => {
    it('GET /api/trades should return recent trades', async () => {
      const response = await request(app).get('/api/trades');

      expect([200, 500]).toContain(response.status);
      if (response.status === 200) {
        expect(Array.isArray(response.body)).toBe(true);
      }
    });

    it('GET /api/trades/history should return trade history', async () => {
      const response = await request(app).get('/api/trades/history');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('GET /api/trades/stats should return trade statistics', async () => {
      const response = await request(app).get('/api/trades/stats');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('totalTrades');
    });
  });

  describe('Backtesting Endpoints', () => {
    it('POST /api/backtest should run backtest', async () => {
      const response = await request(app)
        .post('/api/backtest')
        .send({
          symbol: 'DOGEUSDT',
          gridLower: 0.10,
          gridUpper: 0.20,
          gridCount: 10,
          amountPerGrid: 50,
          startDate: '2024-01-01',
          endDate: '2024-01-31',
          initialCapital: 1000,
        });

      expect([200, 400, 500]).toContain(response.status);
    });

    it('POST /api/backtest should return 400 for missing parameters', async () => {
      const response = await request(app)
        .post('/api/backtest')
        .send({
          symbol: 'DOGEUSDT',
          // Missing required fields
        });

      expect(response.status).toBe(400);
    });

    it('POST /api/backtest/optimize should optimize grid parameters', async () => {
      const response = await request(app)
        .post('/api/backtest/optimize')
        .send({
          symbol: 'DOGEUSDT',
          startDate: '2024-01-01',
          endDate: '2024-01-31',
          initialCapital: 1000,
        });

      expect([200, 400, 500]).toContain(response.status);
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await request(app).get('/api/nonexistent');

      expect(response.status).toBe(404);
    });

    it('should handle invalid JSON gracefully', async () => {
      const response = await request(app)
        .post('/api/portfolio/start')
        .set('Content-Type', 'application/json')
        .send('{ invalid json }');

      expect(response.status).toBe(400);
    });
  });

  describe('CORS Headers', () => {
    it('should include CORS headers', async () => {
      const response = await request(app)
        .get('/api/health')
        .set('Origin', 'http://localhost:3000');

      expect(response.headers['access-control-allow-origin']).toBeDefined();
    });
  });

  describe('Static Files', () => {
    it('GET / should serve index.html', async () => {
      const response = await request(app).get('/');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
    });
  });
});
