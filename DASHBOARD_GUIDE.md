# Grid Trading Bot Dashboard - Quick Guide

## What You'll See

The new dashboard is designed to answer one key question: **"What is my bot doing right now?"**

## Dashboard Layout

### Left Panel: Bot Status & Controls

**Bot Controls**

- ▶ **Start** - Begin trading
- ■ **Stop** - Stop all trading

**Current Status Card**

- **What Bot is Doing** - Plain English explanation of current activity
  - Examples: "Monitoring grid levels and executing trades", "Just bought DOGEUSDT", "Waiting to start..."
- **Mode** - Portfolio or Single Pair
- **Active Pairs** - Number of pairs being traded
- **Active Orders** - Number of pending orders
- **Last Action** - Most recent trade or order

**Portfolio Summary**

- **Total Capital** - Your starting capital
- **Allocated** - How much is currently in use
- **Total PnL** - All-time profit/loss
- **Today's PnL** - Profit/loss for today
- **Total Trades** - Number of completed trades
- **Win Rate** - Percentage of profitable trades

**Active Pairs List**

- Click any pair to see its grid visualization
- Shows current price, PnL, orders, trades, and win rate for each pair

---

### Center Panel: Grid Visualization & Charts

**Grid Levels & Current Price**

- **White line** - Current market price (updates in real-time)
- **Green lines** - Buy orders (placed below current price)
- **Red lines** - Sell orders (placed above current price)
- **Blue lines** - Filled orders (already executed)

**How to Read the Grid:**

```
$0.45 ━━━━ RED (Sell) - Bot will sell if price reaches here
$0.40 ━━━━ RED (Sell)
$0.35 ━━━━ WHITE ← Current Price ($0.35)
$0.30 ━━━━ GREEN (Buy) - Bot will buy if price drops here
$0.25 ━━━━ GREEN (Buy)
```

**Trade Cycle Diagram**
Shows the basic grid trading flow:

1. **BUY** - Price drops to a grid level → bot buys
2. **SELL** - Price rises one level up → bot sells
3. **💰 Profit** - Difference between buy and sell price = profit

**Portfolio Value Chart**

- Line chart showing your portfolio value over time
- Green area = profit, trending up

---

### Right Panel: Live Activity & Orders

**Live Activity Feed**
Your bot's action log in real-time:

```
2:45:32 PM
DOGEUSDT: SELL executed at $0.3520 - +$1.50 profit

2:44:18 PM
XLMUSDT: BUY order filled at $0.1234 (500 units)

2:43:05 PM
System: Monitoring grid levels and executing trades
```

**Color Coding:**

- 🟢 Green border = Buy action
- 🔴 Red border = Sell action
- 🔵 Blue border = System message

**Active Orders List**
Shows all pending orders waiting to execute:

- Order type (BUY/SELL)
- Price level
- Symbol
- Quantity

---

## Understanding Grid Trading (Quick Primer)

### What is Grid Trading?

A bot that automatically buys low and sells high within a price range.

### How It Works

1. You define a **price range** (e.g., $0.25 - $0.45)
2. Bot creates a **grid** of buy and sell orders at different levels
3. When price **drops** → bot **buys**
4. When price **rises** → bot **sells** what it bought
5. Each completed buy-sell cycle = **profit**

### Best Market Conditions

- ✅ Sideways/ranging markets (price bounces up and down)
- ✅ Volatile but not trending
- ❌ Strong trending markets (price only goes one direction)

---

## Status Indicators

### Bot Status Badge (Top Right)

- 🟢 **RUNNING** (green, pulsing) - Bot is actively trading
- ⚫ **STOPPED** (gray) - Bot is off
- 🟠 **PAUSED** (orange) - Bot paused due to risk limits

### Simulation Mode Badge

- 🟢 **SIMULATION** (green) - Using fake money (safe for testing)
- 🔴 **⚠️ LIVE TRADING** (red, pulsing) - Using real money (be careful!)

---

## Key Metrics Explained

### PnL (Profit and Loss)

- **Green** = Making money
- **Red** = Losing money
- Calculated from completed trades only

### Win Rate

- Percentage of trades that made profit
- Example: 75% = 75 out of 100 trades were profitable

### Allocated Capital

- Money currently being used in trades
- Unallocated capital = cash reserve

### Active Orders

- Orders waiting to execute
- High number = bot is actively managing many grid levels

---

## What to Watch For

### Normal Operation

- Active orders slowly fill and replace
- Activity feed shows regular buy/sell actions
- PnL gradually increases (small gains per trade)
- Grid visualization shows price moving between levels

### Warning Signs

- **No activity for hours** - Check if bot is running
- **All orders filled on one side** - Price may have broken out of range
- **Rapidly increasing losses** - Price is trending strongly in one direction
- **Bot status = PAUSED** - Risk limits triggered (check Risk Management tab)

---

## Tips for Monitoring

1. **Check the "What Bot is Doing" status** - Quick at-a-glance understanding
2. **Watch the Live Activity Feed** - See every action as it happens
3. **Monitor current price vs grid** - Ensure price stays in range
4. **Review Today's PnL** - Track daily performance
5. **Check Win Rate** - Should be >50% for profitable grid trading

---

## Accessing the Dashboard

- **Local**: http://localhost:3002
- **Production**: https://your-alb-domain.com

Make sure you're logged in (Cognito authentication required in production).

---

## Still Confused?

### "I don't see any activity"

- Check if bot is **RUNNING** (green badge)
- Make sure you have **active pairs** in the left panel
- Verify **simulation or live mode** is configured correctly

### "Grid looks empty"

- Click on an **active pair** in the left panel to load its grid
- Make sure bot is running and has placed orders

### "Activity feed is empty"

- Wait for bot actions (can take time in low-volatility markets)
- Check **Active Orders** count - if 0, bot may not be set up correctly

### "I want to see detailed trade history"

- Old dashboard still available at: `index-old.html`
- Has tabs for Trade History, Analytics, Risk Management, etc.
- New dashboard focuses on real-time monitoring only

---

## Quick Start Checklist

- [ ] Bot status shows **RUNNING**
- [ ] See at least 1 active pair in left panel
- [ ] Grid visualization shows colored lines
- [ ] Active orders count > 0
- [ ] Activity feed is receiving updates
- [ ] Simulation badge shows expected mode

If all checked, your bot is working correctly!
