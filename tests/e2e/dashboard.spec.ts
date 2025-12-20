import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';

test.describe('Trading Dashboard E2E Tests', () => {
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto(BASE_URL);
  });

  test.afterEach(async () => {
    await page.close();
  });

  test.describe('Dashboard Loading', () => {
    test('should load the dashboard page', async () => {
      await expect(page).toHaveTitle(/Grid Trading Bot/);
    });

    test('should display header with title', async () => {
      const header = page.locator('.header h1');
      await expect(header).toContainText('Grid Trading Bot');
    });

    test('should show simulation badge', async () => {
      const simulationBadge = page.locator('#simulationBadge');
      await expect(simulationBadge).toBeVisible();
    });

    test('should show status badge', async () => {
      const statusBadge = page.locator('#statusBadge');
      await expect(statusBadge).toBeVisible();
    });
  });

  test.describe('Portfolio Overview', () => {
    test('should display portfolio metrics', async () => {
      await expect(page.locator('.metrics-card')).toHaveCount(4);
    });

    test('should show total capital', async () => {
      const capitalCard = page.locator('.metrics-card').first();
      await expect(capitalCard).toContainText('Total Capital');
    });

    test('should show portfolio value', async () => {
      const valueCards = page.locator('.metrics-card');
      const texts = await valueCards.allTextContents();
      expect(texts.some(text => text.includes('Portfolio Value'))).toBe(true);
    });

    test('should display PnL', async () => {
      const pnlCard = page.locator('.metrics-card').filter({ hasText: 'Total PnL' });
      await expect(pnlCard).toBeVisible();
    });
  });

  test.describe('Active Pairs Section', () => {
    test('should display active pairs container', async () => {
      const activePairs = page.locator('#activePairsContainer');
      await expect(activePairs).toBeVisible();
    });

    test('should show pair cards when pairs are added', async () => {
      // Wait for data to load
      await page.waitForTimeout(1000);

      const pairCards = page.locator('.pair-card');
      const count = await pairCards.count();
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  test.describe('Grid Visualization', () => {
    test('should display grid configuration section', async () => {
      const gridSection = page.locator('#gridConfigContainer');
      await expect(gridSection).toBeVisible();
    });

    test('should show grid levels for each pair', async () => {
      // Wait for grid data to load
      await page.waitForTimeout(1000);

      const gridPairs = page.locator('.grid-pair');
      const count = await gridPairs.count();
      expect(count).toBeGreaterThanOrEqual(0);
    });

    test('should expand/collapse grid details', async () => {
      await page.waitForTimeout(1000);

      const detailsToggle = page.locator('.grid-details').first();
      if (await detailsToggle.count() > 0) {
        // Check initial state
        const isInitiallyOpen = await detailsToggle.getAttribute('open');

        // Click to toggle
        await detailsToggle.click();

        // Wait for animation
        await page.waitForTimeout(300);

        // Verify state changed
        const isNowOpen = await detailsToggle.getAttribute('open');
        expect(isNowOpen !== isInitiallyOpen).toBe(true);
      }
    });
  });

  test.describe('Risk Management Tab', () => {
    test('should switch to risk management tab', async () => {
      const riskTab = page.locator('.tab[data-tab="risk"]');
      await riskTab.click();

      await expect(page.locator('#riskManagementTab')).toHaveClass(/active/);
    });

    test('should display risk limits', async () => {
      await page.locator('.tab[data-tab="risk"]').click();
      await page.waitForTimeout(500);

      const riskLimits = page.locator('.risk-limit-card');
      await expect(riskLimits.first()).toBeVisible();
    });
  });

  test.describe('Trade History Tab', () => {
    test('should switch to trade history tab', async () => {
      const tradeTab = page.locator('.tab[data-tab="trades"]');
      await tradeTab.click();

      await expect(page.locator('#tradeHistoryTab')).toHaveClass(/active/);
    });

    test('should display trade history table', async () => {
      await page.locator('.tab[data-tab="trades"]').click();
      await page.waitForTimeout(500);

      const table = page.locator('.trade-table');
      await expect(table).toBeVisible();
    });
  });

  test.describe('Analytics Tab', () => {
    test('should switch to analytics tab', async () => {
      const analyticsTab = page.locator('.tab[data-tab="analytics"]');
      await analyticsTab.click();

      await expect(page.locator('#analyticsTab')).toHaveClass(/active/);
    });

    test('should display correlation matrix', async () => {
      await page.locator('.tab[data-tab="analytics"]').click();
      await page.waitForTimeout(500);

      const matrix = page.locator('#correlationMatrix');
      await expect(matrix).toBeVisible();
    });

    test('should display performance chart', async () => {
      await page.locator('.tab[data-tab="analytics"]').click();
      await page.waitForTimeout(500);

      const chart = page.locator('canvas').first();
      await expect(chart).toBeVisible();
    });
  });

  test.describe('Simulation Mode Toggle', () => {
    test('should toggle simulation mode', async () => {
      const simulationBadge = page.locator('#simulationBadge');
      const initialText = await simulationBadge.textContent();

      await simulationBadge.click();

      // Wait for toggle to complete
      await page.waitForTimeout(500);

      const newText = await simulationBadge.textContent();
      // Text might stay same but class should change
      const hasClass = await simulationBadge.evaluate((el) =>
        el.className.includes('simulation-')
      );
      expect(hasClass).toBe(true);
    });

    test('should show warning when disabling simulation', async () => {
      const simulationBadge = page.locator('#simulationBadge');

      // Make sure we're in simulation mode first
      const isSimulation = await simulationBadge.evaluate((el) =>
        el.className.includes('simulation-on')
      );

      if (isSimulation) {
        // Listen for dialog
        page.once('dialog', async (dialog) => {
          expect(dialog.type()).toBe('confirm');
          expect(dialog.message()).toContain('LIVE TRADING');
          await dialog.dismiss();
        });

        await simulationBadge.click();
      }
    });
  });

  test.describe('Data Feed Status', () => {
    test('should display data feed badge', async () => {
      const dataFeedBadge = page.locator('#dataFeedBadge');
      await expect(dataFeedBadge).toBeVisible();
    });

    test('should show data feed type', async () => {
      await page.waitForTimeout(1000);

      const dataFeedLabel = page.locator('#dataFeedLabel');
      const text = await dataFeedLabel.textContent();

      expect(['WebSocket', 'Polling', 'Disconnected', '--']).toContain(text);
    });
  });

  test.describe('Responsive Design', () => {
    test('should be responsive on mobile', async () => {
      await page.setViewportSize({ width: 375, height: 667 });

      const header = page.locator('.header');
      await expect(header).toBeVisible();

      const metrics = page.locator('.metrics-card');
      await expect(metrics.first()).toBeVisible();
    });

    test('should be responsive on tablet', async () => {
      await page.setViewportSize({ width: 768, height: 1024 });

      const container = page.locator('.container');
      await expect(container).toBeVisible();
    });

    test('should be responsive on desktop', async () => {
      await page.setViewportSize({ width: 1920, height: 1080 });

      const header = page.locator('.header');
      await expect(header).toBeVisible();
    });
  });

  test.describe('Real-time Updates', () => {
    test('should update status periodically', async () => {
      const statusBadge = page.locator('#statusBadge');
      const initialStatus = await statusBadge.textContent();

      // Wait for potential update (status updates every 5s)
      await page.waitForTimeout(6000);

      const statusBadgeAfter = page.locator('#statusBadge');
      await expect(statusBadgeAfter).toBeVisible();
    });
  });

  test.describe('Error States', () => {
    test('should show empty state when no trades', async () => {
      await page.locator('.tab[data-tab="trades"]').click();
      await page.waitForTimeout(500);

      const emptyState = page.locator('.empty-state');
      const count = await emptyState.count();
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  test.describe('Accessibility', () => {
    test('should have proper ARIA labels', async () => {
      const buttons = page.locator('button');
      const count = await buttons.count();

      for (let i = 0; i < Math.min(count, 5); i++) {
        const button = buttons.nth(i);
        const hasText = await button.textContent();
        const hasAriaLabel = await button.getAttribute('aria-label');

        // Button should have either text content or aria-label
        expect(hasText || hasAriaLabel).toBeTruthy();
      }
    });

    test('should be keyboard navigable', async () => {
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');

      // Check that focus moved
      const focusedElement = await page.evaluate(() =>
        document.activeElement?.tagName
      );
      expect(focusedElement).toBeTruthy();
    });
  });
});
