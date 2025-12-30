import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("validation");

// Common schemas
const symbolSchema = z.string().regex(/^[A-Z]+USDT?$/, {
  message: "Symbol must be in format like DOGEUSDT or XLMUSDT",
});

const positiveNumberSchema = z.number().positive();
const dateStringSchema = z.string().datetime();
const limitSchema = z
  .number()
  .int()
  .min(1)
  .max(1000)
  .default(100)
  .or(z.string().transform((val) => parseInt(val, 10)))
  .refine((val) => !isNaN(val) && val >= 1 && val <= 1000, {
    message: "Limit must be between 1 and 1000",
  });

// Query parameter schemas
export const TradeHistoryQuerySchema = z.object({
  symbol: symbolSchema.optional(),
  limit: limitSchema.optional(),
});

export const TradeStatsQuerySchema = z.object({
  symbol: symbolSchema.optional(),
});

export const RiskEventsQuerySchema = z.object({
  limit: limitSchema.optional(),
});

export const AnalyticsQuerySchema = z.object({
  symbol: symbolSchema.optional(),
  startDate: dateStringSchema.optional(),
  endDate: dateStringSchema.optional(),
});

export const GridQuerySchema = z.object({
  pair: symbolSchema.optional(),
});

// Request body schemas
export const BacktestSchema = z
  .object({
    symbol: symbolSchema,
    gridLower: positiveNumberSchema,
    gridUpper: positiveNumberSchema,
    gridCount: z.number().int().min(3).max(100),
    amountPerGrid: positiveNumberSchema.max(100000),
    startDate: dateStringSchema,
    endDate: dateStringSchema,
    initialCapital: positiveNumberSchema.max(10000000).default(1000),
  })
  .refine((data) => data.gridUpper > data.gridLower, {
    message: "gridUpper must be greater than gridLower",
    path: ["gridUpper"],
  })
  .refine((data) => new Date(data.endDate) > new Date(data.startDate), {
    message: "endDate must be after startDate",
    path: ["endDate"],
  })
  .refine((data) => new Date(data.startDate) < new Date(), {
    message: "startDate cannot be in the future",
    path: ["startDate"],
  });

export const OptimizeGridSchema = z
  .object({
    symbol: symbolSchema,
    startDate: dateStringSchema,
    endDate: dateStringSchema,
    initialCapital: positiveNumberSchema.max(10000000).default(1000),
  })
  .refine((data) => new Date(data.endDate) > new Date(data.startDate), {
    message: "endDate must be after startDate",
    path: ["endDate"],
  });

export const PortfolioStartSchema = z.object({
  pairs: z
    .array(
      z.object({
        symbol: symbolSchema,
        baseAsset: z.string().min(1).max(20),
        quoteAsset: z.string().min(1).max(20),
        gridLower: positiveNumberSchema,
        gridUpper: positiveNumberSchema,
        gridCount: z.number().int().min(3).max(100),
        amountPerGrid: positiveNumberSchema.max(100000),
        gridType: z.enum(["arithmetic", "geometric"]),
        allocationPercent: z.number().min(0).max(100),
        enabled: z.boolean(),
      }),
    )
    .optional(),
  totalCapital: positiveNumberSchema.max(10000000).optional(),
  riskStrategy: z.enum(["conservative", "moderate", "aggressive"]).optional(),
});

export const AddPairSchema = z
  .object({
    symbol: symbolSchema.optional(),
    pair: z
      .object({
        symbol: symbolSchema,
        baseAsset: z.string().min(1).max(20),
        quoteAsset: z.string().min(1).max(20),
        gridLower: positiveNumberSchema,
        gridUpper: positiveNumberSchema,
        gridCount: z.number().int().min(3).max(100),
        amountPerGrid: positiveNumberSchema.max(100000),
        gridType: z.enum(["arithmetic", "geometric"]),
        allocationPercent: z.number().min(0).max(100),
        enabled: z.boolean(),
      })
      .optional(),
  })
  .refine((data) => data.symbol || data.pair, {
    message: "Either symbol or pair must be provided",
  });

export const UpdateStrategySchema = z.object({
  strategy: z.enum(["conservative", "moderate", "aggressive"]),
});

export const ToggleSimulationSchema = z.object({
  enabled: z.boolean(),
  confirmLiveTrading: z.boolean().optional(),
});

// Validation middleware factory
export function validateBody<T extends z.ZodType>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body) as z.infer<T>;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.warn(
          { errors: error.errors, path: req.path },
          "Validation failed",
        );
        res.status(400).json({
          error: "Validation failed",
          details: error.errors.map((err) => ({
            field: err.path.join("."),
            message: err.message,
          })),
        });
      } else {
        logger.error({ error }, "Unexpected validation error");
        res.status(400).json({ error: "Invalid request" });
      }
    }
  };
}

export function validateQuery<T extends z.ZodType>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      // Parse query parameters with proper type coercion
      const parsedQuery: Record<string, string | number | undefined> = {};
      for (const [key, value] of Object.entries(req.query)) {
        if (typeof value === "string") {
          // Try to parse as number if it looks like a number
          if (!isNaN(Number(value)) && value !== "") {
            parsedQuery[key] = Number(value);
          } else {
            parsedQuery[key] = value;
          }
        } else {
          parsedQuery[key] = value as string | number | undefined;
        }
      }

      req.query = schema.parse(parsedQuery) as z.infer<T>;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.warn(
          { errors: error.errors, path: req.path },
          "Query validation failed",
        );
        res.status(400).json({
          error: "Invalid query parameters",
          details: error.errors.map((err) => ({
            field: err.path.join("."),
            message: err.message,
          })),
        });
      } else {
        logger.error({ error }, "Unexpected query validation error");
        res.status(400).json({ error: "Invalid request" });
      }
    }
  };
}

export function validateParams<T extends z.ZodType>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.params = schema.parse(req.params) as z.infer<T>;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.warn(
          { errors: error.errors, path: req.path },
          "Params validation failed",
        );
        res.status(400).json({
          error: "Invalid URL parameters",
          details: error.errors.map((err) => ({
            field: err.path.join("."),
            message: err.message,
          })),
        });
      } else {
        logger.error({ error }, "Unexpected params validation error");
        res.status(400).json({ error: "Invalid request" });
      }
    }
  };
}
