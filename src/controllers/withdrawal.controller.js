const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');

// Customer: Submit a withdrawal request (Bank Wire or ACH)
async function createWithdrawal(req, res) {
  if (req.user.status === 'INACTIVE' || req.user.account?.status === 'DORMANT' || req.user.account?.status === 'FROZEN' || req.user.account?.status === 'CLOSED') {
    return res.status(403).json({
      success: false,
      status: 'ACCOUNT_INACTIVE',
      message: 'This account is currently inactive. Withdrawals are disabled. Kindly contact customer support.'
    });
  }

  const conn = await pool.getConnection();
  try {
    const accountId = req.user.account.id;
    const userId = req.user.id;
    const { amount, method, destinationDetails } = req.body;

    if (!amount || !method || !destinationDetails) {
      return res.status(400).json({
        success: false,
        message: 'Amount, withdrawal method, and destination details are required.'
      });
    }

    const withdrawalAmount = parseFloat(amount);
    if (isNaN(withdrawalAmount) || withdrawalAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Withdrawal amount must be a valid positive number.'
      });
    }

    const validMethods = ['BANK_WIRE', 'ACH_TRANSFER', 'SWIFT_WIRE'];
    if (!validMethods.includes(method)) {
      return res.status(400).json({
        success: false,
        message: `Method must be one of: ${validMethods.join(', ')}`
      });
    }

    await conn.beginTransaction();

    // Check account balance and lock row
    const [accRows] = await conn.execute(
      `SELECT available_balance, ledger_balance, currency FROM accounts WHERE id = ? FOR UPDATE`,
      [accountId]
    );

    if (!accRows || accRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Account not found.' });
    }

    const currentBal = parseFloat(accRows[0].available_balance);
    const fee = method === 'BANK_WIRE' ? 15.00 : (method === 'SWIFT_WIRE' ? 25.00 : 0.00);
    const totalDeduction = withdrawalAmount + fee;

    if (currentBal < totalDeduction) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: `Insufficient funds. Available: $${currentBal.toFixed(2)}, Required: $${totalDeduction.toFixed(2)} (including $${fee.toFixed(2)} wire processing fee).`
      });
    }

    // Hold funds by deducting from available_balance
    const newAvailable = currentBal - totalDeduction;
    await conn.execute(
      `UPDATE accounts SET available_balance = ? WHERE id = ?`,
      [newAvailable, accountId]
    );

    // Generate withdrawal reference
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    const randCode = Math.floor(1000 + Math.random() * 9000);
    const referenceNumber = `WTH-OTB-${dateStr}-${randCode}`;
    const withdrawalId = uuidv4();

    await conn.execute(
      `INSERT INTO withdrawals (
        id, account_id, user_id, reference_number, amount, fee, 
        currency, method, destination_details, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_APPROVAL')`,
      [
        withdrawalId,
        accountId,
        userId,
        referenceNumber,
        withdrawalAmount,
        fee,
        accRows[0].currency,
        method,
        destinationDetails.trim()
      ]
    );

    await conn.commit();

    return res.status(201).json({
      success: true,
      message: 'Withdrawal request submitted successfully. Held in pending queue for administrative authorization.',
      data: {
        id: withdrawalId,
        referenceNumber,
        amount: withdrawalAmount.toFixed(2),
        fee: fee.toFixed(2),
        method,
        status: 'PENDING_APPROVAL',
        remainingBalance: newAvailable.toFixed(2)
      }
    });
  } catch (err) {
    await conn.rollback();
    console.error('Error in createWithdrawal:', err);
    return res.status(500).json({ success: false, message: 'Failed to process withdrawal request.' });
  } finally {
    conn.release();
  }
}

// Customer: List user withdrawals
async function listUserWithdrawals(req, res) {
  try {
    const userId = req.user.id;
    const [rows] = await pool.execute(
      `SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC`,
      [userId]
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('Error in listUserWithdrawals:', err);
    return res.status(500).json({ success: false, message: 'Failed to list withdrawals.' });
  }
}

// Admin: List all pending and processed withdrawals
async function listAdminWithdrawals(req, res) {
  try {
    const { status } = req.query;
    let query = `
      SELECT w.*, a.account_number, u.first_name, u.last_name, u.email
      FROM withdrawals w
      JOIN accounts a ON a.id = w.account_id
      JOIN users u ON u.id = w.user_id
    `;
    const params = [];
    if (status) {
      query += ` WHERE w.status = ?`;
      params.push(status);
    }
    query += ` ORDER BY w.created_at DESC`;

    const [rows] = await pool.execute(query, params);
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('Error in listAdminWithdrawals:', err);
    return res.status(500).json({ success: false, message: 'Failed to list admin withdrawals.' });
  }
}

// Admin: Approve withdrawal
async function approveWithdrawal(req, res) {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const { adminRemarks } = req.body;
    const adminId = req.user.id;

    await conn.beginTransaction();

    const [rows] = await conn.execute(
      `SELECT w.*, a.ledger_balance, a.available_balance, a.account_number, a.currency
       FROM withdrawals w
       JOIN accounts a ON a.id = w.account_id
       WHERE w.id = ? FOR UPDATE`,
      [id]
    );

    if (!rows || rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Withdrawal request not found.' });
    }

    const withdrawal = rows[0];
    if (withdrawal.status !== 'PENDING_APPROVAL') {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: `Withdrawal has already been marked as ${withdrawal.status}.`
      });
    }

    const totalDeduction = parseFloat(withdrawal.amount) + parseFloat(withdrawal.fee);
    const newLedger = parseFloat(withdrawal.ledger_balance) - totalDeduction;

    // Finalize ledger deduction
    await conn.execute(
      `UPDATE accounts SET ledger_balance = ? WHERE id = ?`,
      [newLedger, withdrawal.account_id]
    );

    // Update withdrawal record
    await conn.execute(
      `UPDATE withdrawals 
       SET status = 'APPROVED', admin_remarks = ?, reviewed_by = ?, reviewed_at = NOW() 
       WHERE id = ?`,
      [adminRemarks || 'Approved and disbursed via secure gateway', adminId, id]
    );

    // Post to transaction history
    await conn.execute(
      `INSERT INTO transactions (
        id, account_id, reference_number, transaction_type, channel, 
        amount, fee, currency, counterparty_name, counterparty_bank, 
        counterparty_account, narration, status
      ) VALUES (?, ?, ?, 'DEBIT', 'INTERNATIONAL_WIRE', ?, ?, ?, ?, ?, ?, ?, 'COMPLETED')`,
      [
        uuidv4(),
        withdrawal.account_id,
        withdrawal.reference_number,
        withdrawal.amount,
        withdrawal.fee,
        withdrawal.currency,
        withdrawal.method.replace('_', ' '),
        'Disbursed Gateway',
        withdrawal.destination_details.slice(0, 48),
        `Withdrawal Authorized: ${withdrawal.destination_details}`
      ]
    );

    await conn.commit();

    return res.status(200).json({
      success: true,
      message: 'Withdrawal successfully approved and disbursed.',
      data: { id, status: 'APPROVED' }
    });
  } catch (err) {
    await conn.rollback();
    console.error('Error in approveWithdrawal:', err);
    return res.status(500).json({ success: false, message: 'Failed to approve withdrawal.' });
  } finally {
    conn.release();
  }
}

// Admin: Reject withdrawal (atomically refund held available balance)
async function rejectWithdrawal(req, res) {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const { adminRemarks } = req.body;
    const adminId = req.user.id;

    await conn.beginTransaction();

    const [rows] = await conn.execute(
      `SELECT w.*, a.available_balance 
       FROM withdrawals w 
       JOIN accounts a ON a.id = w.account_id 
       WHERE w.id = ? FOR UPDATE`,
      [id]
    );

    if (!rows || rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Withdrawal not found.' });
    }

    const withdrawal = rows[0];
    if (withdrawal.status !== 'PENDING_APPROVAL') {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: `Withdrawal has already been marked as ${withdrawal.status}.`
      });
    }

    const totalRefund = parseFloat(withdrawal.amount) + parseFloat(withdrawal.fee);
    const restoredBal = parseFloat(withdrawal.available_balance) + totalRefund;

    // Restore available balance
    await conn.execute(
      `UPDATE accounts SET available_balance = ? WHERE id = ?`,
      [restoredBal, withdrawal.account_id]
    );

    // Update status to REJECTED
    await conn.execute(
      `UPDATE withdrawals 
       SET status = 'REJECTED', admin_remarks = ?, reviewed_by = ?, reviewed_at = NOW() 
       WHERE id = ?`,
      [adminRemarks || 'Declined during administrative compliance review. Held funds restored.', adminId, id]
    );

    await conn.commit();

    return res.status(200).json({
      success: true,
      message: 'Withdrawal request rejected. Held funds restored to customer available balance.',
      data: { id, status: 'REJECTED' }
    });
  } catch (err) {
    await conn.rollback();
    console.error('Error in rejectWithdrawal:', err);
    return res.status(500).json({ success: false, message: 'Failed to reject withdrawal.' });
  } finally {
    conn.release();
  }
}

module.exports = {
  createWithdrawal,
  listUserWithdrawals,
  listAdminWithdrawals,
  approveWithdrawal,
  rejectWithdrawal
};
