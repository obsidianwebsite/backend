const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');

// Customer: Submit / Claim Tax Refund
async function claimRefund(req, res) {
  try {
    const accountId = req.user.account.id;
    const userId = req.user.id;
    const { taxYear, ssnTinMasked, expectedAmount, filingStatus, notes } = req.body;

    if (!taxYear || !expectedAmount) {
      return res.status(400).json({
        success: false,
        message: 'Tax year and expected refund amount are required.'
      });
    }

    const amount = parseFloat(expectedAmount);
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Expected amount must be a positive number.'
      });
    }

    const randNum = Math.floor(1000 + Math.random() * 9000);
    const filingId = `IRS-TX-${taxYear}-${randNum}`;
    const claimId = uuidv4();

    await pool.execute(
      `INSERT INTO tax_refunds (
        id, user_id, account_id, filing_id, tax_year, ssn_tin_masked, 
        expected_amount, filing_status, refund_stage, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'RECEIVED', ?)`,
      [
        claimId,
        userId,
        accountId,
        filingId,
        taxYear,
        ssnTinMasked || '***-**-5192',
        amount,
        filingStatus || 'SINGLE',
        notes || 'Form 1040 submitted via Electronic Filing PIN.'
      ]
    );

    return res.status(201).json({
      success: true,
      message: 'Tax refund claim registered. Tracking active in official IRS pipeline.',
      data: {
        id: claimId,
        filingId,
        taxYear,
        expectedAmount: amount.toFixed(2),
        refundStage: 'RECEIVED'
      }
    });
  } catch (err) {
    console.error('Error in claimRefund:', err);
    return res.status(500).json({ success: false, message: 'Failed to submit tax refund claim.' });
  }
}

// Customer: List user tax claims
async function listUserRefunds(req, res) {
  try {
    const userId = req.user.id;
    const [rows] = await pool.execute(
      `SELECT * FROM tax_refunds WHERE user_id = ? ORDER BY created_at DESC`,
      [userId]
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('Error in listUserRefunds:', err);
    return res.status(500).json({ success: false, message: 'Failed to list tax claims.' });
  }
}

// Admin: List all tax refund claims
async function listAdminTaxClaims(req, res) {
  try {
    const { stage } = req.query;
    let query = `
      SELECT t.*, a.account_number, u.first_name, u.last_name, u.email
      FROM tax_refunds t
      JOIN accounts a ON a.id = t.account_id
      JOIN users u ON u.id = t.user_id
    `;
    const params = [];
    if (stage) {
      query += ` WHERE t.refund_stage = ?`;
      params.push(stage);
    }
    query += ` ORDER BY t.created_at DESC`;

    const [rows] = await pool.execute(query, params);
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('Error in listAdminTaxClaims:', err);
    return res.status(500).json({ success: false, message: 'Failed to list admin tax claims.' });
  }
}

// Admin: Update refund stage (RECEIVED, UNDER_REVIEW, APPROVED, DISBURSED)
async function updateTaxStage(req, res) {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const { stage, notes } = req.body;

    const validStages = ['RECEIVED', 'UNDER_REVIEW', 'APPROVED', 'DISBURSED'];
    if (!validStages.includes(stage)) {
      return res.status(400).json({ success: false, message: `Stage must be one of: ${validStages.join(', ')}` });
    }

    await conn.beginTransaction();

    const [claims] = await conn.execute(
      `SELECT t.*, a.id as account_id, a.available_balance, a.ledger_balance, a.currency
       FROM tax_refunds t
       JOIN accounts a ON a.id = t.account_id
       WHERE t.id = ? FOR UPDATE`,
      [id]
    );

    if (!claims || claims.length === 0) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Tax claim not found.' });
    }

    const claim = claims[0];

    if (stage === 'DISBURSED' && claim.refund_stage !== 'DISBURSED') {
      const refundAmt = parseFloat(claim.expected_amount);
      const newAvail = parseFloat(claim.available_balance) + refundAmt;
      const newLedger = parseFloat(claim.ledger_balance) + refundAmt;

      // Credit account
      await conn.execute(
        `UPDATE accounts SET available_balance = ?, ledger_balance = ? WHERE id = ?`,
        [newAvail, newLedger, claim.account_id]
      );

      // Post transaction
      await conn.execute(
        `INSERT INTO transactions (
          id, account_id, reference_number, transaction_type, channel, 
          amount, fee, currency, counterparty_name, counterparty_bank, 
          counterparty_account, narration, status
        ) VALUES (?, ?, ?, 'CREDIT', 'DEPOSIT', ?, 0, ?, 'Internal Revenue Service (IRS)', 'Federal Treasury Bank', 'IRS-FED-CLEARING', ?, 'COMPLETED')`,
        [
          uuidv4(),
          claim.account_id,
          claim.filing_id,
          refundAmt,
          claim.currency,
          `Federal Tax Refund Disbursed (${claim.tax_year} Tax Return)`
        ]
      );

      await conn.execute(
        `UPDATE tax_refunds SET refund_stage = 'DISBURSED', disbursed_at = NOW(), notes = ? WHERE id = ?`,
        [notes || 'Direct deposit processed and credited to customer checking account.', id]
      );
    } else {
      await conn.execute(
        `UPDATE tax_refunds SET refund_stage = ?, notes = ? WHERE id = ?`,
        [stage, notes || `Status updated to ${stage}`, id]
      );
    }

    await conn.commit();

    return res.status(200).json({
      success: true,
      message: `Tax claim status successfully updated to ${stage}.`,
      data: { id, stage }
    });
  } catch (err) {
    await conn.rollback();
    console.error('Error in updateTaxStage:', err);
    return res.status(500).json({ success: false, message: 'Failed to update tax stage.' });
  } finally {
    conn.release();
  }
}

module.exports = {
  claimRefund,
  listUserRefunds,
  listAdminTaxClaims,
  updateTaxStage
};
