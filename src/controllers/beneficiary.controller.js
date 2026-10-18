const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');

// List All Saved Beneficiaries
async function listBeneficiaries(req, res) {
  try {
    const accountId = req.user.account.id;

    const [rows] = await pool.execute(
      `SELECT id, name, bank_name, account_number, swift_routing, bank_address, created_at 
       FROM beneficiaries 
       WHERE account_id = ? 
       ORDER BY created_at DESC`,
      [accountId]
    );

    return res.status(200).json({
      success: true,
      status: 'SUCCESS',
      data: rows
    });
  } catch (err) {
    console.error('Error in listBeneficiaries:', err);
    return res.status(500).json({
      success: false,
      status: 'SERVER_ERROR',
      message: 'Failed to retrieve saved beneficiaries.'
    });
  }
}

// Add New Beneficiary
async function addBeneficiary(req, res) {
  try {
    const accountId = req.user.account.id;
    const { name, bankName, accountNumber, swiftRouting, bankAddress } = req.body;

    if (!name || !bankName || !accountNumber) {
      return res.status(400).json({
        success: false,
        status: 'VALIDATION_ERROR',
        message: 'Beneficiary Name, Bank Name, and Account Number are required.'
      });
    }

    const id = uuidv4();
    await pool.execute(
      `INSERT INTO beneficiaries (id, account_id, name, bank_name, account_number, swift_routing, bank_address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        accountId,
        name.trim(),
        bankName.trim(),
        accountNumber.trim(),
        swiftRouting ? swiftRouting.trim() : null,
        bankAddress ? bankAddress.trim() : null
      ]
    );

    return res.status(201).json({
      success: true,
      status: 'SUCCESS',
      message: 'Beneficiary added successfully.',
      data: {
        id,
        name,
        bankName,
        accountNumber
      }
    });
  } catch (err) {
    console.error('Error in addBeneficiary:', err);
    return res.status(500).json({
      success: false,
      status: 'SERVER_ERROR',
      message: 'Failed to save beneficiary.'
    });
  }
}

// Delete Beneficiary by ID
async function deleteBeneficiary(req, res) {
  try {
    const accountId = req.user.account.id;
    const { id } = req.params;

    const [result] = await pool.execute(
      `DELETE FROM beneficiaries WHERE id = ? AND account_id = ?`,
      [id, accountId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        status: 'NOT_FOUND',
        message: 'Beneficiary record not found.'
      });
    }

    return res.status(200).json({
      success: true,
      status: 'SUCCESS',
      message: 'Beneficiary deleted successfully.'
    });
  } catch (err) {
    console.error('Error in deleteBeneficiary:', err);
    return res.status(500).json({
      success: false,
      status: 'SERVER_ERROR',
      message: 'Failed to delete beneficiary.'
    });
  }
}

module.exports = {
  listBeneficiaries,
  addBeneficiary,
  deleteBeneficiary
};
