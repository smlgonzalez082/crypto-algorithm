import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getGridLevels } from '../src/utils/config.js';

// Mock the config module
vi.mock('../src/utils/config.js', async () => {
  const actual = await vi.importActual('../src/utils/config.js');
  return {
    ...actual,
    config: {
      gridUpper: 45000,
      gridLower: 40000,
      gridCount: 5,
      gridType: 'arithmetic',
    },
  };
});

describe('getGridLevels', () => {
  describe('arithmetic grid', () => {
    beforeEach(() => {
      vi.doMock('../src/utils/config.js', () => ({
        config: {
          gridUpper: 45000,
          gridLower: 40000,
          gridCount: 5,
          gridType: 'arithmetic',
        },
      }));
    });

    it('should generate correct number of levels', async () => {
      const { getGridLevels: getArithmeticLevels } = await import('../src/utils/config.js');
      const levels = getArithmeticLevels();
      expect(levels.length).toBe(6); // gridCount + 1
    });

    it('should have equal spacing for arithmetic grid', async () => {
      const { getGridLevels: getArithmeticLevels } = await import('../src/utils/config.js');
      const levels = getArithmeticLevels();
      const spacing = levels[1] - levels[0];

      for (let i = 1; i < levels.length; i++) {
        expect(levels[i] - levels[i - 1]).toBeCloseTo(spacing, 2);
      }
    });

    it('should start at lower price and end at upper price', async () => {
      const { getGridLevels: getArithmeticLevels } = await import('../src/utils/config.js');
      const levels = getArithmeticLevels();
      expect(levels[0]).toBe(40000);
      expect(levels[levels.length - 1]).toBe(45000);
    });
  });
});

describe('GridConfigSchema', () => {
  it('should validate correct config', async () => {
    const { GridConfigSchema } = await import('../src/types/index.js');

    const config = {
      tradingPair: 'BTCUSDT',
      upperPrice: 45000,
      lowerPrice: 40000,
      gridCount: 10,
      amountPerGrid: 0.001,
      gridType: 'arithmetic' as const,
    };

    const result = GridConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('should reject invalid grid count', async () => {
    const { GridConfigSchema } = await import('../src/types/index.js');

    const config = {
      tradingPair: 'BTCUSDT',
      upperPrice: 45000,
      lowerPrice: 40000,
      gridCount: 1, // Below minimum of 2
      amountPerGrid: 0.001,
      gridType: 'arithmetic' as const,
    };

    const result = GridConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('should reject negative prices', async () => {
    const { GridConfigSchema } = await import('../src/types/index.js');

    const config = {
      tradingPair: 'BTCUSDT',
      upperPrice: -45000,
      lowerPrice: 40000,
      gridCount: 10,
      amountPerGrid: 0.001,
      gridType: 'arithmetic' as const,
    };

    const result = GridConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});
