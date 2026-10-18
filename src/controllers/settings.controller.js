const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');

// Change Login Password
async function changePassword(req, res) {
  try {
    const userId = req.user.id;
    const { oldPassword, newPassword, confirmPassword } = req.body;

    if (!oldPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        status: 'REQUIRED_FIELD',
        message: 'Old Password, New Password, and Confirm Password are required.'
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        status: 'PASSWORD_MISMATCH',
        message: 'New password confirmation does not match.'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        status: 'PASSWORD_TOO_SHORT',
        message: 'New password must specify at least 6 characters.'
      });
    }

    // Retrieve current password hash
    const [rows] = await pool.execute(
      `SELECT password_hash FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );

    const isMatch = await bcrypt.compare(oldPassword, rows[0].password_hash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        status: 'INVALID_OLD_PASSWORD',
        message: 'Current password provided is incorrect.'
      });
    }

    // Hash and update new password
    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.execute(
      `UPDATE users SET password_hash = ? WHERE id = ?`,
      [newHash, userId]
    );

    // Audit log
    await pool.execute(
      `INSERT INTO audit_logs (id, user_id, event_type, ip_address, user_agent, metadata)
       VALUES (?, ?, 'PASSWORD_CHANGED', ?, ?, ?)`,
      [
        uuidv4(),
        userId,
        req.user.clientIp,
        req.headers['user-agent'] || 'Browser Client',
        JSON.stringify({ timestamp: new Date().toISOString() })
      ]
    );

    return res.status(200).json({
      success: true,
      status: 'SUCCESS',
      message: 'Your login password has been successfully updated.'
    });
  } catch (err) {
    console.error('Error in changePassword:', err);
    return res.status(500).json({
      success: false,
      status: 'SERVER_ERROR',
      message: 'Failed to update password.'
    });
  }
}

// Change Transaction PIN
async function changePin(req, res) {
  try {
    const userId = req.user.id;
    const { oldPin, newPin, confirmPin } = req.body;

    if (!oldPin || !newPin || !confirmPin) {
      return res.status(400).json({
        success: false,
        status: 'REQUIRED_FIELD',
        message: 'Old PIN, New PIN, and Confirm PIN are required.'
      });
    }

    if (newPin.toString() !== confirmPin.toString()) {
      return res.status(400).json({
        success: false,
        status: 'PIN_MISMATCH',
        message: 'PIN confirmation does not match.'
      });
    }

    const pinStr = newPin.toString().trim();
    if (pinStr.length < 4 || pinStr.length > 6 || isNaN(Number(pinStr))) {
      return res.status(400).json({
        success: false,
        status: 'INVALID_PIN_FORMAT',
        message: 'PIN must be an integer between 4 and 6 digits.'
      });
    }

    // Retrieve current PIN hash
    const [rows] = await pool.execute(
      `SELECT pin_hash FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );

    const isMatch = await bcrypt.compare(oldPin.toString().trim(), rows[0].pin_hash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        status: 'INVALID_OLD_PIN',
        message: 'Current PIN provided is incorrect.'
      });
    }

    // Hash and update new PIN
    const newHash = await bcrypt.hash(pinStr, 10);
    await pool.execute(
      `UPDATE users SET pin_hash = ? WHERE id = ?`,
      [newHash, userId]
    );

    // Audit log
    await pool.execute(
      `INSERT INTO audit_logs (id, user_id, event_type, ip_address, user_agent, metadata)
       VALUES (?, ?, 'PIN_CHANGED', ?, ?, ?)`,
      [
        uuidv4(),
        userId,
        req.user.clientIp,
        req.headers['user-agent'] || 'Browser Client',
        JSON.stringify({ timestamp: new Date().toISOString() })
      ]
    );

    return res.status(200).json({
      success: true,
      status: 'SUCCESS',
      message: 'Your 4-6 digit security PIN has been successfully updated.'
    });
  } catch (err) {
    console.error('Error in changePin:', err);
    return res.status(500).json({
      success: false,
      status: 'SERVER_ERROR',
      message: 'Failed to update PIN.'
    });
  }
}

module.exports = {
  changePassword,
  changePin
};
