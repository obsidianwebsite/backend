const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');

// Customer: Submit Grant Application
async function applyGrant(req, res) {
  try {
    const accountId = req.user.account.id;
    const userId = req.user.id;
    const { programmeName, category, amountRequested, businessPurpose } = req.body;

    if (!programmeName || !amountRequested || !businessPurpose) {
      return res.status(400).json({
        success: false,
        message: 'Programme name, amount requested, and business purpose are required.'
      });
    }

    const amount = parseFloat(amountRequested);
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Requested amount must be a positive number.'
      });
    }

    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    const randCode = Math.floor(1000 + Math.random() * 9000);
    const referenceNumber = `GRT-OTB-${dateStr}-${randCode}`;
    const grantId = uuidv4();

    await pool.execute(
      `INSERT INTO grants (
        id, user_id, account_id, reference_number, programme_name, 
        category, amount_requested, business_purpose, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PROCESSING')`,
      [
        grantId,
        userId,
        accountId,
        referenceNumber,
        programmeName.trim(),
        category || 'Business Development',
        amount,
        businessPurpose.trim()
      ]
    );

    return res.status(201).json({
      success: true,
      message: 'Grant application submitted successfully. Underwriting review in progress.',
      data: {
        id: grantId,
        referenceNumber,
        programmeName,
        amountRequested: amount.toFixed(2),
        status: 'PROCESSING'
      }
    });
  } catch (err) {
    console.error('Error in applyGrant:', err);
    return res.status(500).json({ success: false, message: 'Failed to submit grant application.' });
  }
}

// Customer: List user grant applications
async function listUserGrants(req, res) {
  try {
    const userId = req.user.id;
    const [rows] = await pool.execute(
      `SELECT * FROM grants WHERE user_id = ? ORDER BY created_at DESC`,
      [userId]
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('Error in listUserGrants:', err);
    return res.status(500).json({ success: false, message: 'Failed to list grants.' });
  }
}

// Admin: List all grants
async function listAdminGrants(req, res) {
  try {
    const { status } = req.query;
    let query = `
      SELECT g.*, a.account_number, u.first_name, u.last_name, u.email
      FROM grants g
      JOIN accounts a ON a.id = g.account_id
      JOIN users u ON u.id = g.user_id
    `;
    const params = [];
    if (status) {
      query += ` WHERE g.status = ?`;
      params.push(status);
    }
    query += ` ORDER BY g.created_at DESC`;

    const [rows] = await pool.execute(query, params);
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('Error in listAdminGrants:', err);
    return res.status(500).json({ success: false, message: 'Failed to list admin grants.' });
  }
}

// Admin: Review Grant (Approve, Reject, or Disburse funds atomically)
async function reviewGrant(req, res) {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const { action, adminRemarks } = req.body; // action: 'APPROVE', 'REJECT', 'DISBURSE'

    if (!['APPROVE', 'REJECT', 'DISBURSE'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Action must be APPROVE, REJECT, or DISBURSE.' });
    }

    await conn.beginTransaction();

    const [grants] = await conn.execute(
      `SELECT g.*, a.id as account_id, a.available_balance, a.ledger_balance, a.currency
       FROM grants g
       JOIN accounts a ON a.id = g.account_id
       WHERE g.id = ? FOR UPDATE`,
      [id]
    );

    if (!grants || grants.length === 0) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Grant application not found.' });
    }

    const grant = grants[0];

    if (action === 'REJECT') {
      await conn.execute(
        `UPDATE grants SET status = 'REJECTED', admin_remarks = ? WHERE id = ?`,
        [adminRemarks || 'Application did not meet grant qualification requirements.', id]
      );
      await conn.commit();
      return res.status(200).json({ success: true, message: 'Grant marked as REJECTED.' });
    }

    if (action === 'APPROVE') {
      await conn.execute(
        `UPDATE grants SET status = 'APPROVED', admin_remarks = ? WHERE id = ?`,
        [adminRemarks || 'Grant application approved. Awaiting capital disbursement.', id]
      );
      await conn.commit();
      return res.status(200).json({ success: true, message: 'Grant status set to APPROVED.' });
    }

    if (action === 'DISBURSE') {
      if (grant.status === 'DISBURSED') {
        await conn.rollback();
        return res.status(400).json({ success: false, message: 'Grant funds have already been disbursed.' });
      }

      const grantAmount = parseFloat(grant.amount_requested);
      const newAvail = parseFloat(grant.available_balance) + grantAmount;
      const newLedger = parseFloat(grant.ledger_balance) + grantAmount;

      // Credit customer account
      await conn.execute(
        `UPDATE accounts SET available_balance = ?, ledger_balance = ? WHERE id = ?`,
        [newAvail, newLedger, grant.account_id]
      );

      // Update grant record
      await conn.execute(
        `UPDATE grants SET status = 'DISBURSED', disbursed_at = NOW(), admin_remarks = ? WHERE id = ?`,
        [adminRemarks || 'Grant funds disbursed into customer commercial checking account.', id]
      );

      // Insert transaction
      await conn.execute(
        `INSERT INTO transactions (
          id, account_id, reference_number, transaction_type, channel, 
          amount, fee, currency, counterparty_name, counterparty_bank, 
          counterparty_account, narration, status
        ) VALUES (?, ?, ?, 'CREDIT', 'DEPOSIT', ?, 0, ?, 'VaultAtlantic Capital Foundation', 'VaultAtlantic PLC', 'FEDERAL-GRANT-VAULT', ?, 'COMPLETED')`,
        [
          uuidv4(),
          grant.account_id,
          grant.reference_number,
          grantAmount,
          grant.currency,
          `Grant Disbursement: ${grant.programme_name}`
        ]
      );

      await conn.commit();

      return res.status(200).json({
        success: true,
        message: `Grant successfully disbursed! $${grantAmount.toFixed(2)} credited to customer account.`,
        data: { id, status: 'DISBURSED' }
      });
    }
  } catch (err) {
    await conn.rollback();
    console.error('Error in reviewGrant:', err);
    return res.status(500).json({ success: false, message: 'Failed to process grant review.' });
  } finally {
    conn.release();
  }
}

module.exports = {
  applyGrant,
  listUserGrants,
  listAdminGrants,
  reviewGrant
};
