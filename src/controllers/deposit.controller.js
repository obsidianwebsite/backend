const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');

// Customer submits a deposit simulation (held in PENDING_APPROVAL)
async function createDeposit(req, res) {
  try {
    if (req.user.status === 'INACTIVE' || req.user.account?.status === 'DORMANT' || req.user.account?.status === 'FROZEN' || req.user.account?.status === 'CLOSED') {
      return res.status(403).json({
        success: false,
        status: 'ACCOUNT_INACTIVE',
        message: 'This account is currently inactive. Deposits are disabled. Kindly contact customer support.'
      });
    }

    const accountId = req.user.account.id;
    const {
      amount,
      currency,
      method, // 'BANK_TRANSFER' | 'CHECK_DEPOSIT' | 'WIRE_DEPOSIT'
      payerName,
      payerBank,
      checkNumber,
      proofNote
    } = req.body;

    const depositAmount = parseFloat(amount);
    if (isNaN(depositAmount) || depositAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Deposit amount must be a positive number.' });
    }

    const refNumber = `DEP-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}`;

    await pool.execute(
      `INSERT INTO deposits (
        id, account_id, amount, currency, method, reference_number, 
        payer_name, payer_bank, check_number, proof_note, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_APPROVAL')`,
      [
        uuidv4(),
        accountId,
        depositAmount,
        currency || 'USD',
        method || 'BANK_TRANSFER',
        refNumber,
        payerName ? payerName.trim() : 'Self Inward Wire',
        payerBank ? payerBank.trim() : 'External Financial Institution',
        checkNumber ? checkNumber.trim() : null,
        proofNote ? proofNote.trim() : null
      ]
    );

    return res.status(201).json({
      success: true,
      status: 'PENDING_APPROVAL',
      message: 'Deposit simulation submitted successfully. It has been routed to the Master Admin queue for compliance verification and ledger settlement.',
      data: {
        referenceNumber: refNumber,
        amount: depositAmount.toFixed(2),
        currency: currency || 'USD',
        method: method || 'BANK_TRANSFER',
        status: 'PENDING_APPROVAL'
      }
    });
  } catch (err) {
    console.error('Error in createDeposit:', err);
    return res.status(500).json({ success: false, message: 'Failed to submit deposit simulation.' });
  }
}

// Customer retrieves their deposit requests
async function listUserDeposits(req, res) {
  try {
    const accountId = req.user.account.id;
    const [rows] = await pool.execute(
      `SELECT * FROM deposits WHERE account_id = ? ORDER BY created_at DESC`,
      [accountId]
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('Error in listUserDeposits:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch deposits.' });
  }
}

module.exports = {
  createDeposit,
  listUserDeposits
};
