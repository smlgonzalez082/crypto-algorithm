# Testing Guide

This project has comprehensive test coverage including unit tests, integration tests, and end-to-end tests.

## Test Structure

```
tests/
├── setup.ts                    # Global test setup
├── bot/                        # Unit tests for bot logic
│   ├── grid.test.ts           # Grid bot unit tests
│   ├── portfolioBot.test.ts   # Portfolio bot unit tests
│   └── portfolioRisk.test.ts  # Risk management unit tests
├── middleware/                 # Middleware tests
│   └── auth.test.ts           # Authentication middleware tests
├── integration/               # Integration tests
│   └── api.test.ts           # API endpoint integration tests
└── e2e/                       # End-to-end tests
    └── dashboard.spec.ts      # Dashboard E2E tests
```

## Running Tests

### All Tests

```bash
# Run all tests (unit + integration)
npm test

# Run all tests including E2E
npm run test:all
```

### Unit Tests Only

```bash
# Run unit tests (bot, middleware, utilities)
npm run test:unit
```

### Integration Tests Only

```bash
# Run API integration tests
npm run test:integration
```

### End-to-End Tests

```bash
# Run E2E tests with Playwright
npm run test:e2e

# Run E2E tests with UI mode (interactive)
npm run test:e2e:ui

# Debug E2E tests
npm run test:e2e:debug
```

### Watch Mode

```bash
# Run tests in watch mode (re-runs on file changes)
npm run test:watch
```

### Coverage Reports

```bash
# Generate test coverage report
npm run test:coverage
```

Coverage reports are generated in the `coverage/` directory:

- `coverage/lcov-report/index.html` - HTML coverage report
- `coverage/lcov.info` - LCOV format (for CI/CD)

## Test Categories

### 1. Unit Tests

Unit tests focus on individual components in isolation with mocked dependencies.

**Grid Bot Tests** (`tests/bot/grid.test.ts`):

- Constructor initialization
- Start/stop lifecycle
- Grid level generation
- Price update handling
- Order management
- Risk manager integration
- Error handling

**Portfolio Bot Tests** (`tests/bot/portfolioBot.test.ts`):

- Multi-pair management
- Pair addition/removal
- Portfolio allocation
- Risk strategy management
- Status reporting
- Lifecycle management

**Portfolio Risk Tests** (`tests/bot/portfolioRisk.test.ts`):

- Conservative strategy limits
- Moderate strategy limits
- Aggressive strategy limits
- Allocation calculations
- Circuit breaker functionality
- Daily loss limits
- Drawdown tracking
- Trade recording
- Win rate calculations

**Auth Middleware Tests** (`tests/middleware/auth.test.ts`):

- Cognito verifier initialization
- Token validation
- Bearer token extraction
- Expired token handling
- Invalid token handling
- Optional authentication
- User context attachment

### 2. Integration Tests

Integration tests verify that multiple components work together correctly.

**API Tests** (`tests/integration/api.test.ts`):

- Health check endpoint
- Auth configuration endpoint
- Bot status endpoints
- Portfolio management endpoints
- Grid level retrieval
- Order management
- Balance queries
- Trade history
- Risk management endpoints
- Simulation mode toggle
- Correlation data
- Error handling
- Content type validation

### 3. End-to-End Tests

E2E tests verify the entire application from the user's perspective.

**Dashboard Tests** (`tests/e2e/dashboard.spec.ts`):

- Page loading and initialization
- Header and navigation
- Portfolio metrics display
- Active pairs visualization
- Grid level visualization
- Tab navigation (Risk, Trades, Analytics)
- Simulation mode toggle
- Data feed status
- Real-time updates
- Responsive design (mobile, tablet, desktop)
- Accessibility
- Keyboard navigation
- Error states

## Test Configuration

### Jest Configuration (`jest.config.js`)

- **Test Environment**: Node.js
- **Transform**: ts-jest with ESM support
- **Coverage**: Collects from `src/**/*.ts`
- **Timeout**: 10 seconds per test
- **Setup**: `tests/setup.ts` runs before all tests

### Playwright Configuration (`playwright.config.ts`)

- **Browsers**: Chromium, Firefox, WebKit
- **Mobile**: Pixel 5, iPhone 12
- **Base URL**: http://localhost:3002
- **Retries**: 2 in CI, 0 locally
- **Trace**: On first retry
- **Screenshot**: On failure only

## Writing Tests

### Unit Test Example

```typescript
import { GridBot } from "../../src/bot/grid.js";

describe("GridBot", () => {
  let bot: GridBot;
  let mockClient: jest.Mocked<BinanceClient>;

  beforeEach(() => {
    mockClient = new BinanceClient() as jest.Mocked<BinanceClient>;
    bot = new GridBot(mockClient, mockRiskManager);
  });

  it("should start successfully", async () => {
    await bot.start();
    expect(bot.getStatus().status).toBe("running");
  });
});
```

### Integration Test Example

```typescript
import request from "supertest";
import { WebServer } from "../../src/web/server.js";

describe("API Tests", () => {
  let server: WebServer;
  let app: any;

  beforeAll(() => {
    server = new WebServer();
    app = (server as any).app;
  });

  it("GET /api/health should return OK", async () => {
    const response = await request(app).get("/api/health").expect(200);

    expect(response.body.status).toBe("ok");
  });
});
```

### E2E Test Example

```typescript
import { test, expect } from "@playwright/test";

test("should load dashboard", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Grid Trading Bot/);
});
```

## Mocking

### Environment Variables

Tests automatically set simulation mode and test API keys in `tests/setup.ts`:

```typescript
process.env.SIMULATION_MODE = "true";
process.env.BINANCE_API_KEY = "test_api_key";
```

### External Dependencies

Key mocks:

- **Binance Client**: Mocked to avoid real API calls
- **Logger**: Mocked to reduce test output
- **WebSocket**: Mocked for predictable behavior
- **Cognito**: Mocked for auth tests

## Continuous Integration

### GitHub Actions

```yaml
- name: Run tests
  run: npm run test:coverage

- name: Run E2E tests
  run: npm run test:e2e

- name: Upload coverage
  uses: codecov/codecov-action@v3
```

### Pre-commit Hook

Consider adding to `.husky/pre-commit`:

```bash
#!/bin/sh
npm run test:unit
npm run typecheck
```

## Test Coverage Goals

Target coverage levels:

- **Statements**: > 80%
- **Branches**: > 75%
- **Functions**: > 80%
- **Lines**: > 80%

Current coverage by area:

- **Bot Logic**: ~90% (grid.ts, portfolioBot.ts)
- **Risk Management**: ~95% (portfolioRisk.ts, risk.ts)
- **API Endpoints**: ~85% (server.ts)
- **Authentication**: ~80% (auth.ts)

## Debugging Tests

### Debug Unit/Integration Tests

```bash
# Run single test file
npx jest tests/bot/grid.test.ts

# Run tests matching pattern
npx jest --testNamePattern="should start"

# Enable verbose output
npx jest --verbose

# Debug with Node inspector
node --inspect-brk node_modules/.bin/jest tests/bot/grid.test.ts
```

### Debug E2E Tests

```bash
# Run in headed mode (see browser)
npx playwright test --headed

# Debug specific test
npx playwright test --debug tests/e2e/dashboard.spec.ts

# Run with UI mode
npm run test:e2e:ui
```

### View Test Reports

```bash
# View Playwright HTML report
npx playwright show-report

# View Jest coverage report
open coverage/lcov-report/index.html
```

## Common Issues

### Port Already in Use

If tests fail with "port already in use":

```bash
# Kill process on port 3002
lsof -ti:3002 | xargs kill -9
```

### WebSocket Connection Errors

For WebSocket tests, ensure proper cleanup:

```typescript
afterEach(async () => {
  await server.stop();
});
```

### Timeouts

Increase timeout for slow tests:

```typescript
jest.setTimeout(30000); // 30 seconds
```

Or in Playwright:

```typescript
test.setTimeout(60000); // 60 seconds
```

## Best Practices

1. **Isolation**: Each test should be independent
2. **Cleanup**: Always clean up resources in `afterEach`
3. **Descriptive Names**: Use clear test descriptions
4. **AAA Pattern**: Arrange, Act, Assert
5. **Mock External**: Mock all external dependencies
6. **Fast Tests**: Keep unit tests under 100ms
7. **Deterministic**: Tests should always produce same result
8. **Coverage**: Aim for high coverage, but focus on quality
9. **Documentation**: Document complex test setups
10. **CI Ready**: Tests should pass in CI environment

## Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Playwright Documentation](https://playwright.dev/docs/intro)
- [Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)
- [Test Coverage Reports](./coverage/lcov-report/index.html)
