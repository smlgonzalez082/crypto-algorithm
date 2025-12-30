# Order Tracking Guide

## When Orders Are Placed vs Executed

### Order Lifecycle

Your grid trading bot follows this order lifecycle:

```
1. ORDER PLACED → 2. WAITING → 3. ORDER FILLED (EXECUTED)
```

### When Buy/Sell Orders Are PLACED

Orders are placed at specific times:

1. **Bot Start**: When you click "Start Bot"
   - Bot calculates grid levels (±20% from current price, 15 levels)
   - Places BUY orders below current price at each level
   - Places SELL orders above current price at each level
   - Example: If DOGE is at $0.35
     - BUY orders: $0.34, $0.33, $0.32, $0.31... down to $0.28
     - SELL orders: $0.36, $0.37, $0.38, $0.39... up to $0.42

2. **After Order Fill**: When a grid order executes
   - If a BUY fills → bot immediately places a SELL one level up
   - If a SELL fills → bot immediately places a BUY one level down
   - This creates the "buy low, sell high" profit cycle

### When Orders Are EXECUTED (FILLED)

Orders execute automatically when:

- **BUY order**: Market price drops to or below the order price
- **SELL order**: Market price rises to or above the order price

Example timeline:

```
10:00 AM - 📝 BUY order PLACED at $0.34 (waiting...)
10:15 AM - ✅ BUY order FILLED at $0.34 (market dropped, order executed!)
10:15 AM - 📝 SELL order PLACED at $0.35 (one level up)
10:30 AM - ✅ SELL order FILLED at $0.35 (market rose, order executed!)
         - 💰 Profit = $0.01 per unit (minus fees)
10:30 AM - 📝 BUY order PLACED at $0.34 (cycle repeats)
```

## How to Track Orders in Dashboard

### 1. Active Orders Panel (Right Column)

Located below the Live Activity Feed, shows:

- **Total order count** in header badge
- **Orders grouped by trading pair**
- **Buy/Sell breakdown** per pair (e.g., "5 BUY · 3 SELL")
- **Top 5 pending orders** per pair with:
  - Order type (BUY/SELL)
  - Price level
  - Quantity
  - "⏳ Pending" status

**Auto-refreshes every 10 seconds**

### 2. Live Activity Feed (Right Column)

Real-time log showing:

- **📝 PLACED**: When bot creates a new order (waiting for price to reach level)

  ```
  2:45:32 PM
  DOGEUSDT: 📝 BUY order PLACED at $0.3400 - Waiting for execution
  ```

- **✅ FILLED**: When order executes (market price reached the level)
  ```
  2:50:18 PM
  DOGEUSDT: ✅ BUY order FILLED at $0.3400 - Order executed!
  ```

### 3. Grid Visualization (Center Panel)

Visual representation of order levels:

- **White line**: Current market price (updates in real-time)
- **Green lines**: Active BUY orders (waiting to execute)
- **Red lines**: Active SELL orders (waiting to execute)
- **Blue lines**: Filled orders (already executed)

Watch the white line move toward colored lines - when it crosses a line, that order executes!

### 4. Last Action (Left Panel - Bot Status)

Quick snapshot showing most recent order activity:

- "Placed BUY @ $0.3400"
- "Filled SELL @ $0.3500"

## Understanding Order Flow

### Normal Operation

You should see:

1. Multiple orders in "Active Orders" panel (10-30 per pair is typical)
2. Periodic updates in Live Activity Feed as orders fill
3. Grid visualization showing price bouncing between levels
4. Orders count slowly decreasing as they fill, then replenishing

### Example: Profitable Trade Cycle

```
1. Current price: $0.35
2. 📝 BUY PLACED at $0.34
3. Price drops to $0.34
4. ✅ BUY FILLED at $0.34 (you now own crypto)
5. 📝 SELL PLACED at $0.35 (one level up)
6. Price rises to $0.35
7. ✅ SELL FILLED at $0.35 (you sell the crypto)
8. 💰 Profit = $0.01 per unit
9. 📝 BUY PLACED at $0.34 (cycle repeats)
```

## What to Watch For

### ✅ Healthy Activity

- Orders filling and being replaced regularly
- Mix of BUY and SELL orders in Active Orders panel
- Activity feed showing both PLACED and FILLED messages
- Price staying within grid range

### ⚠️ Warning Signs

- **All orders on one side filled**: Price may have broken out of range
  - Example: All BUY orders filled, no SELL orders = price crashed below grid
  - Example: All SELL orders filled, no BUY orders = price mooned above grid
- **No FILLED messages for hours**: Market too stable (low volatility)
- **Orders only being PLACED, never FILLED**: Grid range may be too narrow

## Quick Checklist

When bot is running, you should see:

- ✅ Active Orders count > 0
- ✅ Both BUY and SELL orders in Active Orders panel
- ✅ Activity feed receiving PLACED and FILLED updates
- ✅ Grid visualization showing current price between colored lines
- ✅ Last Action showing recent order activity

If all checked, your order tracking is working correctly!

## Dashboard URL

- **Local Development**: http://localhost:3002
- **Production**: https://your-alb-domain.com (requires Cognito login)

---

**Note**: In SIMULATION mode, orders are placed against simulated market data. In LIVE mode, orders are sent to Binance.US exchange. Always test in simulation first!
