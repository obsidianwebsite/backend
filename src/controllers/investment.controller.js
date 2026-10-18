const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');

// Customer: List available institutional investment plans
async function listPlans(req, res) {
  try {
    const [plans] = await pool.execute(`SELECT * FROM investment_plans WHERE status = 'ACTIVE' ORDER BY min_amount ASC`);
    return res.status(200).json({ success: true, data: plans });
  } catch (err) {
    console.error('Error in listPlans:', err);
    return res.status(500).json({ success: false, message: 'Failed to list investment plans.' });
  }
}

// Customer: Subscribe to an investment plan
async function subscribePlan(req, res) {
  const conn = await pool.getConnection();
  try {
    const accountId = req.user.account.id;
    const userId = req.user.id;
    const { planId, amount } = req.body;

    if (!planId || !amount) {
      return res.status(400).json({ success: false, message: 'Plan ID and investment amount are required.' });
    }

    const investAmount = parseFloat(amount);
    if (isNaN(investAmount) || investAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Investment amount must be a positive number.' });
    }

    await conn.beginTransaction();

    // 1. Fetch Plan details
    const [plans] = await conn.execute(`SELECT * FROM investment_plans WHERE id = ? AND status = 'ACTIVE'`, [planId]);
    if (!plans || plans.length === 0) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Investment plan not found or inactive.' });
    }

    const plan = plans[0];
    const minAmt = parseFloat(plan.min_amount);
    const maxAmt = parseFloat(plan.max_amount);

    if (investAmount < minAmt || investAmount > maxAmt) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: `Investment amount for ${plan.name} must be between $${minAmt.toLocaleString()} and $${maxAmt.toLocaleString()}.`
      });
    }

    // 2. Lock and check account available balance
    const [accRows] = await conn.execute(
      `SELECT available_balance, ledger_balance, investment_earnings, currency FROM accounts WHERE id = ? FOR UPDATE`,
      [accountId]
    );

    if (!accRows || accRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Account not found.' });
    }

    const currentBal = parseFloat(accRows[0].available_balance);
    if (currentBal < investAmount) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: `Insufficient funds. Available: $${currentBal.toFixed(2)}, Required: $${investAmount.toFixed(2)}.`
      });
    }

    // 3. Deduct from balance
    const newAvail = currentBal - investAmount;
    const newLedger = parseFloat(accRows[0].ledger_balance) - investAmount;
    const expectedRoi = investAmount * (parseFloat(plan.roi_percent) / 100);

    await conn.execute(
      `UPDATE accounts SET available_balance = ?, ledger_balance = ? WHERE id = ?`,
      [newAvail, newLedger, accountId]
    );

    // 4. Create user investment record
    const investmentId = uuidv4();
    await conn.execute(
      `INSERT INTO user_investments (
        id, user_id, account_id, plan_id, amount_invested, expected_roi, 
        duration_days, status, start_date, end_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', NOW(), DATE_ADD(NOW(), INTERVAL ? DAY))`,
      [
        investmentId,
        userId,
        accountId,
        planId,
        investAmount,
        expectedRoi,
        plan.duration_days,
        plan.duration_days
      ]
    );

    // 5. Post debit transaction
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    const randCode = Math.floor(1000 + Math.random() * 9000);
    const refNum = `TXN-INV-${dateStr}-${randCode}`;

    await conn.execute(
      `INSERT INTO transactions (
        id, account_id, reference_number, transaction_type, channel, 
        amount, fee, currency, counterparty_name, counterparty_bank, 
        counterparty_account, narration, status
      ) VALUES (?, ?, ?, 'DEBIT', 'WALLET_EXCHANGE', ?, 0, ?, ?, 'VaultAtlantic Prime Vault', 'VA-INV-FACILITY', ?, 'COMPLETED')`,
      [
        uuidv4(),
        accountId,
        refNum,
        investAmount,
        accRows[0].currency,
        `VaultAtlantic Capital: ${plan.name}`,
        `Investment Allocation into ${plan.name} (${plan.duration_days} days @ ${plan.roi_percent}% ROI)`
      ]
    );

    await conn.commit();

    return res.status(201).json({
      success: true,
      message: `Successfully allocated $${investAmount.toFixed(2)} into ${plan.name}. Expected ROI: $${expectedRoi.toFixed(2)}.`,
      data: {
        investmentId,
        planName: plan.name,
        amountInvested: investAmount.toFixed(2),
        expectedRoi: expectedRoi.toFixed(2),
        durationDays: plan.duration_days,
        remainingBalance: newAvail.toFixed(2)
      }
    });
  } catch (err) {
    await conn.rollback();
    console.error('Error in subscribePlan:', err);
    return res.status(500).json({ success: false, message: 'Failed to subscribe to investment plan.' });
  } finally {
    conn.release();
  }
}

// Customer: List user active and completed investments
async function listUserInvestments(req, res) {
  try {
    const userId = req.user.id;
    const [rows] = await pool.execute(
      `SELECT ui.*, p.name AS plan_name, p.category, p.roi_percent, p.risk_level
       FROM user_investments ui
       JOIN investment_plans p ON p.id = ui.plan_id
       WHERE ui.user_id = ?
       ORDER BY ui.start_date DESC`,
      [userId]
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('Error in listUserInvestments:', err);
    return res.status(500).json({ success: false, message: 'Failed to list user investments.' });
  }
}

// Admin: List all user investments across platform
async function listAllInvestments(req, res) {
  try {
    const [rows] = await pool.execute(
      `SELECT ui.*, p.name AS plan_name, p.roi_percent, u.first_name, u.last_name, u.email, a.account_number
       FROM user_investments ui
       JOIN investment_plans p ON p.id = ui.plan_id
       JOIN users u ON u.id = ui.user_id
       JOIN accounts a ON a.id = ui.account_id
       ORDER BY ui.start_date DESC`
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('Error in listAllInvestments:', err);
    return res.status(500).json({ success: false, message: 'Failed to list all investments.' });
  }
}

// Admin: Create new investment plan
async function createPlan(req, res) {
  try {
    const { name, category, minAmount, maxAmount, durationDays, roiPercent, description, riskLevel } = req.body;
    if (!name || !minAmount || !maxAmount || !durationDays || !roiPercent) {
      return res.status(400).json({ success: false, message: 'Required fields missing for investment plan.' });
    }

    const planId = uuidv4();
    await pool.execute(
      `INSERT INTO investment_plans (id, name, category, min_amount, max_amount, duration_days, roi_percent, description, risk_level, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
      [
        planId,
        name.trim(),
        category || 'Fixed Yield',
        minAmount,
        maxAmount,
        durationDays,
        roiPercent,
        description || '',
        riskLevel || 'MEDIUM'
      ]
    );

    return res.status(201).json({ success: true, message: 'Investment plan created successfully.', data: { id: planId } });
  } catch (err) {
    console.error('Error in createPlan:', err);
    return res.status(500).json({ success: false, message: 'Failed to create investment plan.' });
  }
}

module.exports = {
  listPlans,
  subscribePlan,
  listUserInvestments,
  listAllInvestments,
  createPlan
};
