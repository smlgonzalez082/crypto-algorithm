// Grid Trading Bot - Frontend Application

class TradingBotApp {
    constructor() {
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.isRunning = false;
        this.currentPrice = null;

        this.init();
    }

    init() {
        this.bindElements();
        this.bindEvents();
        this.connectWebSocket();
        this.loadInitialData();
    }

    bindElements() {
        // Status elements
        this.connectionStatus = document.getElementById('connection-status');
        this.botStatus = document.getElementById('bot-status');
        this.botMode = document.getElementById('bot-mode');
        this.tradingPair = document.getElementById('trading-pair');
        this.currentPriceEl = document.getElementById('current-price');
        this.openOrders = document.getElementById('open-orders');
        this.totalTrades = document.getElementById('total-trades');
        this.totalProfit = document.getElementById('total-profit');
        this.uptime = document.getElementById('uptime');
        this.lastUpdate = document.getElementById('last-update');

        // Buttons
        this.startBtn = document.getElementById('start-btn');
        this.stopBtn = document.getElementById('stop-btn');
        this.simulateBtn = document.getElementById('simulate-btn');

        // Form elements
        this.configForm = document.getElementById('config-form');
        this.tradingPairInput = document.getElementById('trading-pair-input');
        this.gridType = document.getElementById('grid-type');
        this.upperPrice = document.getElementById('upper-price');
        this.lowerPrice = document.getElementById('lower-price');
        this.gridCount = document.getElementById('grid-count');
        this.amountPerGrid = document.getElementById('amount-per-grid');
        this.simulationMode = document.getElementById('simulation-mode');
        this.simulatePrice = document.getElementById('simulate-price');

        // Containers
        this.gridVisualization = document.getElementById('grid-visualization');
        this.ordersTableBody = document.querySelector('#orders-table tbody');
        this.tradesTableBody = document.querySelector('#trades-table tbody');
        this.balancesContainer = document.getElementById('balances-container');
        this.simulationControls = document.getElementById('simulation-controls');
    }

    bindEvents() {
        this.startBtn.addEventListener('click', () => this.startBot());
        this.stopBtn.addEventListener('click', () => this.stopBot());
        this.configForm.addEventListener('submit', (e) => this.updateConfig(e));
        this.simulateBtn.addEventListener('click', () => this.simulatePriceChange());

        // Global price adjustment function
        window.adjustPrice = (delta) => this.adjustPrice(delta);
    }

    // WebSocket connection
    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.reconnectAttempts = 0;
            this.updateConnectionStatus(true);
        };

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
        };

        this.ws.onclose = () => {
            console.log('WebSocket disconnected');
            this.updateConnectionStatus(false);
            this.scheduleReconnect();
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        // Send ping every 25 seconds
        setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, 25000);
    }

    scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('Max reconnection attempts reached');
            return;
        }

        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        this.reconnectAttempts++;

        console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
        setTimeout(() => this.connectWebSocket(), delay);
    }

    updateConnectionStatus(connected) {
        this.connectionStatus.textContent = connected ? 'Connected' : 'Disconnected';
        this.connectionStatus.className = `status-badge ${connected ? 'connected' : 'disconnected'}`;
    }

    handleMessage(data) {
        switch (data.type) {
            case 'status':
                this.updateStatus(data.data);
                break;
            case 'pong':
                // Connection alive
                break;
            default:
                console.log('Unknown message type:', data.type);
        }
    }

    // API calls
    async loadInitialData() {
        try {
            const [status, config, dashboard] = await Promise.all([
                this.fetchApi('/api/status'),
                this.fetchApi('/api/config'),
                this.fetchApi('/api/dashboard')
            ]);

            this.updateStatus(status);
            this.updateConfigForm(config);
            this.updateDashboard(dashboard);
        } catch (error) {
            console.error('Failed to load initial data:', error);
        }
    }

    async fetchApi(url, options = {}) {
        const response = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'API request failed');
        }

        return response.json();
    }

    async startBot() {
        try {
            this.startBtn.disabled = true;
            const result = await this.fetchApi('/api/bot/start', {
                method: 'POST',
                body: JSON.stringify({
                    action: 'start',
                    simulation_mode: this.simulationMode.checked
                })
            });
            this.updateStatus(result);
        } catch (error) {
            alert('Failed to start bot: ' + error.message);
        } finally {
            this.startBtn.disabled = false;
        }
    }

    async stopBot() {
        try {
            this.stopBtn.disabled = true;
            const result = await this.fetchApi('/api/bot/stop', {
                method: 'POST'
            });
            this.updateStatus(result);
        } catch (error) {
            alert('Failed to stop bot: ' + error.message);
        } finally {
            this.stopBtn.disabled = false;
        }
    }

    async updateConfig(e) {
        e.preventDefault();

        const config = {
            trading_pair: this.tradingPairInput.value,
            grid_type: this.gridType.value,
            upper_price: parseFloat(this.upperPrice.value),
            lower_price: parseFloat(this.lowerPrice.value),
            grid_count: parseInt(this.gridCount.value),
            amount_per_grid: parseFloat(this.amountPerGrid.value)
        };

        try {
            await this.fetchApi('/api/config', {
                method: 'POST',
                body: JSON.stringify(config)
            });
            alert('Configuration updated successfully');
            this.loadInitialData();
        } catch (error) {
            alert('Failed to update config: ' + error.message);
        }
    }

    async simulatePriceChange() {
        const price = parseFloat(this.simulatePrice.value);
        if (isNaN(price) || price <= 0) {
            alert('Please enter a valid price');
            return;
        }

        try {
            await this.fetchApi('/api/simulate/price', {
                method: 'POST',
                body: JSON.stringify({ price })
            });
        } catch (error) {
            alert('Failed to simulate price: ' + error.message);
        }
    }

    adjustPrice(delta) {
        const current = parseFloat(this.simulatePrice.value) || this.currentPrice || 42500;
        this.simulatePrice.value = (current + delta).toFixed(2);
        this.simulatePriceChange();
    }

    // UI updates
    updateStatus(status) {
        this.isRunning = status.is_running;

        // Update status display
        this.botStatus.textContent = status.is_running ? 'Running' : 'Stopped';
        this.botStatus.className = `value ${status.is_running ? 'running' : 'stopped'}`;

        this.botMode.textContent = status.simulation_mode ? 'Simulation' : 'Live';
        this.tradingPair.textContent = status.trading_pair || '-';

        if (status.current_price) {
            this.currentPrice = status.current_price;
            this.currentPriceEl.textContent = this.formatPrice(status.current_price);
            this.simulatePrice.value = status.current_price.toFixed(2);
        }

        this.openOrders.textContent = status.open_orders;
        this.totalTrades.textContent = status.total_trades;

        const profit = status.total_profit || 0;
        this.totalProfit.textContent = this.formatUSD(profit);
        this.totalProfit.className = `value ${profit >= 0 ? 'profit' : 'loss'}`;

        this.uptime.textContent = this.formatUptime(status.uptime_seconds);

        // Update buttons
        this.startBtn.disabled = status.is_running;
        this.stopBtn.disabled = !status.is_running;

        // Show/hide simulation controls
        this.simulationControls.style.display = status.simulation_mode ? 'block' : 'none';

        this.lastUpdate.textContent = new Date().toLocaleTimeString();

        // Refresh grid and orders if running
        if (status.is_running) {
            this.refreshGridLevels();
            this.refreshOrders();
            this.refreshTrades();
        }
    }

    updateConfigForm(config) {
        this.tradingPairInput.value = config.trading_pair || 'BTCUSDT';
        this.gridType.value = config.grid_type || 'arithmetic';
        this.upperPrice.value = config.upper_price || 45000;
        this.lowerPrice.value = config.lower_price || 40000;
        this.gridCount.value = config.grid_count || 10;
        this.amountPerGrid.value = config.amount_per_grid || 0.001;
    }

    updateDashboard(data) {
        this.updateStatus(data.status);
        this.updateBalances(data.balances);
        this.updateGridVisualization(data.grid_levels);
        this.updateOrdersTable(data.open_orders);
        this.updateTradesTable(data.recent_trades);
    }

    updateBalances(balances) {
        this.balancesContainer.innerHTML = balances.map(b => `
            <div class="balance-item">
                <span class="asset">${b.asset}</span>
                <span class="amount">${this.formatNumber(b.free + b.locked)}</span>
            </div>
        `).join('');
    }

    updateGridVisualization(levels) {
        if (!levels || levels.length === 0) {
            this.gridVisualization.innerHTML = '<p style="color: var(--text-secondary)">No grid levels configured</p>';
            return;
        }

        // Sort by price descending (highest first)
        const sortedLevels = [...levels].sort((a, b) => b.price - a.price);

        this.gridVisualization.innerHTML = sortedLevels.map(level => {
            const isCurrent = this.currentPrice &&
                Math.abs(level.price - this.currentPrice) <
                (sortedLevels[0].price - sortedLevels[sortedLevels.length - 1].price) / levels.length / 2;

            return `
                <div class="grid-level ${isCurrent ? 'current' : ''}">
                    <span class="level-num">#${level.level}</span>
                    <span class="price">${this.formatPrice(level.price)}</span>
                    <div class="orders">
                        <span class="order-indicator ${level.has_buy_order ? 'buy' : ''}"
                              title="${level.has_buy_order ? 'Buy order active' : 'No buy order'}"></span>
                        <span class="order-indicator ${level.has_sell_order ? 'sell' : ''}"
                              title="${level.has_sell_order ? 'Sell order active' : 'No sell order'}"></span>
                    </div>
                </div>
            `;
        }).join('');
    }

    updateOrdersTable(orders) {
        if (!orders || orders.length === 0) {
            this.ordersTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-secondary)">No open orders</td></tr>';
            return;
        }

        this.ordersTableBody.innerHTML = orders.map(order => `
            <tr>
                <td>${order.grid_level ?? '-'}</td>
                <td class="side-${order.side.toLowerCase()}">${order.side}</td>
                <td>${this.formatPrice(order.price)}</td>
                <td>${order.quantity}</td>
                <td>${order.status}</td>
            </tr>
        `).join('');
    }

    updateTradesTable(trades) {
        if (!trades || trades.length === 0) {
            this.tradesTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-secondary)">No trades yet</td></tr>';
            return;
        }

        this.tradesTableBody.innerHTML = trades.slice().reverse().map(trade => `
            <tr>
                <td>${new Date(trade.created_at).toLocaleTimeString()}</td>
                <td class="side-${trade.side.toLowerCase()}">${trade.side}</td>
                <td>${this.formatPrice(trade.price)}</td>
                <td>${trade.quantity}</td>
                <td class="${trade.realized_pnl >= 0 ? 'profit' : 'loss'}">${this.formatUSD(trade.realized_pnl)}</td>
            </tr>
        `).join('');
    }

    async refreshGridLevels() {
        try {
            const levels = await this.fetchApi('/api/grid-levels');
            this.updateGridVisualization(levels);
        } catch (error) {
            console.error('Failed to refresh grid levels:', error);
        }
    }

    async refreshOrders() {
        try {
            const orders = await this.fetchApi('/api/orders');
            this.updateOrdersTable(orders);
        } catch (error) {
            console.error('Failed to refresh orders:', error);
        }
    }

    async refreshTrades() {
        try {
            const trades = await this.fetchApi('/api/trades');
            this.updateTradesTable(trades);
        } catch (error) {
            console.error('Failed to refresh trades:', error);
        }
    }

    // Formatters
    formatPrice(price) {
        if (price === null || price === undefined) return '-';
        return '$' + price.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    formatUSD(amount) {
        if (amount === null || amount === undefined) return '$0.00';
        const sign = amount >= 0 ? '+' : '';
        return sign + '$' + amount.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    formatNumber(num) {
        if (num === null || num === undefined) return '0';
        return num.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 8
        });
    }

    formatUptime(seconds) {
        if (!seconds) return '0s';

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        } else if (minutes > 0) {
            return `${minutes}m ${secs}s`;
        }
        return `${secs}s`;
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new TradingBotApp();
});
