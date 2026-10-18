const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');

// List live trading signals
async function listSignals(req, res) {
  try {
    const [signals] = await pool.execute(`SELECT * FROM trading_signals ORDER BY created_at DESC`);
    return res.status(200).json({ success: true, data: signals });
  } catch (err) {
    console.error('Error in listSignals:', err);
    return res.status(500).json({ success: false, message: 'Failed to list signals.' });
  }
}

// List MT4 copy trading masters
async function listMasters(req, res) {
  try {
    const [masters] = await pool.execute(`SELECT * FROM copy_trading_masters ORDER BY win_rate DESC`);
    return res.status(200).json({ success: true, data: masters });
  } catch (err) {
    console.error('Error in listMasters:', err);
    return res.status(500).json({ success: false, message: 'Failed to list master traders.' });
  }
}

// User: Subscribe / copy a master trader
async function subscribeMaster(req, res) {
  try {
    const userId = req.user.id;
    const { masterId, allocatedAmount } = req.body;

    if (!masterId || !allocatedAmount) {
      return res.status(400).json({ success: false, message: 'Master trader ID and allocated amount are required.' });
    }

    const amount = parseFloat(allocatedAmount);
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Allocated amount must be a positive number.' });
    }

    const subId = uuidv4();
    await pool.execute(
      `INSERT INTO user_copy_subscriptions (id, user_id, master_id, allocated_amount, status)
       VALUES (?, ?, ?, ?, 'ACTIVE')
       ON DUPLICATE KEY UPDATE allocated_amount = VALUES(allocated_amount), status = 'ACTIVE'`,
      [subId, userId, masterId, amount]
    );

    // Increment copiers count
    await pool.execute(`UPDATE copy_trading_masters SET copiers_count = copiers_count + 1 WHERE id = ?`, [masterId]);

    return res.status(200).json({
      success: true,
      message: `Successfully allocated $${amount.toFixed(2)} to mirror master trader's MT4 strategy.`,
      data: { subscriptionId: subId, allocatedAmount: amount.toFixed(2), status: 'ACTIVE' }
    });
  } catch (err) {
    console.error('Error in subscribeMaster:', err);
    return res.status(500).json({ success: false, message: 'Failed to copy trader.' });
  }
}

// User: List active subscriptions
async function listUserSubscriptions(req, res) {
  try {
    const userId = req.user.id;
    const [rows] = await pool.execute(
      `SELECT s.*, m.trader_name, m.strategy_name, m.win_rate, m.monthly_return, m.profit_share_percent, m.avatar_url
       FROM user_copy_subscriptions s
       JOIN copy_trading_masters m ON m.id = s.master_id
       WHERE s.user_id = ?`,
      [userId]
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('Error in listUserSubscriptions:', err);
    return res.status(500).json({ success: false, message: 'Failed to list subscriptions.' });
  }
}

// Admin: Publish new trading signal
async function publishSignal(req, res) {
  try {
    const { instrument, type, direction, entryPrice, stopLoss, takeProfit, timeframe } = req.body;
    if (!instrument || !direction || !entryPrice || !stopLoss || !takeProfit) {
      return res.status(400).json({ success: false, message: 'All signal parameters are required.' });
    }

    const signalId = uuidv4();
    await pool.execute(
      `INSERT INTO trading_signals (id, instrument, type, direction, entry_price, stop_loss, take_profit, timeframe, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
      [
        signalId,
        instrument.toUpperCase(),
        type || 'FOREX',
        direction.toUpperCase(),
        entryPrice,
        stopLoss,
        takeProfit,
        timeframe || '1H'
      ]
    );

    return res.status(201).json({
      success: true,
      message: 'Signal successfully broadcast to all active platform copiers.',
      data: { id: signalId }
    });
  } catch (err) {
    console.error('Error in publishSignal:', err);
    return res.status(500).json({ success: false, message: 'Failed to publish signal.' });
  }
}

// Admin: Delete signal
async function deleteSignal(req, res) {
  try {
    const { id } = req.params;
    await pool.execute(`DELETE FROM trading_signals WHERE id = ?`, [id]);
    return res.status(200).json({ success: true, message: 'Signal deleted.' });
  } catch (err) {
    console.error('Error in deleteSignal:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete signal.' });
  }
}

module.exports = {
  listSignals,
  listMasters,
  subscribeMaster,
  listUserSubscriptions,
  publishSignal,
  deleteSignal
};
