const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');
const { getClientIp } = require('../middleware/auth.middleware');
const emailService = require('../services/email.service');

// Stage 1 Login: Email & Password verification
async function loginStage1(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        status: 'REQUIRED_FIELD',
        message: 'Email and Password are required.'
      });
    }

    const [rows] = await pool.execute(
      `SELECT id, role, first_name, last_name, email, password_hash, status 
       FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1`,
      [email.trim()]
    );

    if (!rows || rows.length === 0) {
      return res.status(401).json({
        success: false,
        status: 'INVALID_CREDENTIALS',
        message: 'Invalid Email or Password. Try Again or contact support to recover your password.'
      });
    }

    const user = rows[0];

    // Check Account Status - Suspended accounts are completely blocked from logging in
    if (user.status === 'SUSPENDED') {
      return res.status(403).json({
        success: false,
        status: 'SUSPENDED',
        message: 'Your account has been suspended. Please contact customer support.'
      });
    }

    // Verify Password Hash
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        status: 'INVALID_CREDENTIALS',
        message: 'Invalid Email or Password. Try Again or contact support to recover your password.'
      });
    }

    // Generate Stage 1 Pre-Auth Token (10 Minutes)
    const preAuthToken = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_PREAUTH_SECRET || 'otb_plc_stage1_preauth_token_key_2026_temporary',
      { expiresIn: process.env.JWT_PREAUTH_EXPIRES_IN || '10m' }
    );

    return res.status(200).json({
      success: true,
      status: 'SUCCESS',
      nextStep: 'PIN_VERIFICATION',
      preAuthToken,
      user: {
        role: user.role || 'CUSTOMER',
        status: user.status,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email
      }
    });
  } catch (err) {
    console.error('Error in loginStage1:', err);
    return res.status(500).json({
      success: false,
      status: 'SERVER_ERROR',
      message: 'An unexpected authentication error occurred.'
    });
  }
}

// Stage 2 Login: PIN verification & Full JWT session generation
async function verifyPinStage2(req, res) {
  try {
    const { pin } = req.body;
    const user = req.preAuthUser;
    const clientIp = req.clientIp || getClientIp(req);

    if (!pin) {
      return res.status(400).json({
        success: false,
        status: 'REQUIRED_FIELD',
        message: 'Account Pin is required.'
      });
    }

    // Verify PIN against secure hash
    const isPinValid = await bcrypt.compare(pin.toString().trim(), user.pin_hash);
    if (!isPinValid) {
      return res.status(401).json({
        success: false,
        status: 'INVALID_PIN',
        message: 'Invalid Account Pin. Try Again or contact your home branch to reset pin.'
      });
    }

    // Generate Full Session JWT (24 Hours)
    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET || 'otb_plc_prod_jwt_secret_key_obsidian_trust_bank_2026_super_secure',
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    // Update Last Login IP and Timestamp
    await pool.execute(
      `UPDATE users SET last_login_at = NOW(), last_login_ip = ? WHERE id = ?`,
      [clientIp, user.id]
    );

    // Log Audit Event
    await pool.execute(
      `INSERT INTO audit_logs (id, user_id, event_type, ip_address, user_agent, metadata)
       VALUES (?, ?, 'LOGIN_SUCCESS', ?, ?, ?)`,
      [
        uuidv4(),
        user.id,
        clientIp,
        req.headers['user-agent'] || 'Browser Client',
        JSON.stringify({ method: '2_STAGE_PIN_VERIFIED' })
      ]
    );

    // Fetch primary account info
    const [accounts] = await pool.execute(
      `SELECT id, account_number, account_type, currency, available_balance, ledger_balance, status 
       FROM accounts WHERE user_id = ? LIMIT 1`,
      [user.id]
    );

    // Asynchronously dispatch Resend Security Sign-In Alert
    if (user && user.email) {
      emailService.sendSecurityLoginAlert({
        to: user.email,
        customerName: `${user.first_name} ${user.last_name}`,
        ipAddress: clientIp,
        userAgent: req.headers['user-agent'] || 'Web Browser',
        timestamp: new Date().toUTCString()
      }).catch(err => console.error('[Email Security Alert Error]:', err));
    }

    return res.status(200).json({
      success: true,
      status: 'SUCCESS',
      message: 'Authentication successful. Welcome to Obsidian Trust Bancorp E-Banking.',
      token,
      user: {
        id: user.id,
        role: user.role || 'CUSTOMER',
        status: user.status,
        firstName: user.first_name,
        lastName: user.last_name,
        fullName: `${user.first_name} ${user.last_name}`,
        email: user.email,
        lastLoginIp: clientIp,
        lastLoginAt: new Date().toISOString()
      },
      account: accounts[0] || null
    });
  } catch (err) {
    console.error('Error in verifyPinStage2:', err);
    return res.status(500).json({
      success: false,
      status: 'SERVER_ERROR',
      message: 'Failed to complete PIN verification.'
    });
  }
}

// Customer Onboarding / Account Opening (/open-account)
async function register(req, res) {
  const conn = await pool.getConnection();
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      password,
      confirmPassword,
      pin,
      confirmPin,
      dateOfBirth,
      gender,
      address,
      city,
      state,
      zipCode,
      accountType,
      currency,
      kycPhotoUrl
    } = req.body;

    // Validate Required Inputs
    if (!firstName || !lastName || !email || !phone || !password || !pin || !dateOfBirth || !address) {
      return res.status(400).json({
        success: false,
        status: 'VALIDATION_ERROR',
        message: 'All personal, residential, and security credentials are required.'
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        status: 'PASSWORD_MISMATCH',
        message: 'Password confirmation does not match.'
      });
    }

    if (pin.toString() !== confirmPin.toString()) {
      return res.status(400).json({
        success: false,
        status: 'PIN_MISMATCH',
        message: 'Account Pin confirmation does not match.'
      });
    }

    // Check if email already registered
    const [existing] = await conn.execute(
      `SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1`,
      [email.trim()]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        status: 'DUPLICATE_EMAIL',
        message: 'An account with this email address already exists in our system.'
      });
    }

    await conn.beginTransaction();

    const userId = uuidv4();
    const accountId = uuidv4();
    const cardId = uuidv4();

    // Hash Password and PIN
    const passwordHash = await bcrypt.hash(password, 10);
    const pinHash = await bcrypt.hash(pin.toString(), 10);

    // Generate unique 10-digit Account Number
    const randomSuffix = Math.floor(1000000000 + Math.random() * 9000000000);
    const accountNumber = `OTB-${randomSuffix}`;

    // 1. Insert User
    await conn.execute(
      `INSERT INTO users (
        id, first_name, last_name, email, password_hash, pin_hash, phone, 
        date_of_birth, gender, address, city, state, zip_code, kyc_photo_url, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
      [
        userId,
        firstName.trim(),
        lastName.trim(),
        email.trim().toLowerCase(),
        passwordHash,
        pinHash,
        phone.trim(),
        dateOfBirth,
        gender || 'Male',
        address.trim(),
        city || '',
        state || '',
        zipCode || '',
        kycPhotoUrl || null
      ]
    );

    // 2. Insert Primary Account (Default zero initial balance)
    await conn.execute(
      `INSERT INTO accounts (
        id, user_id, account_number, account_type, currency, 
        available_balance, ledger_balance, status
      ) VALUES (?, ?, ?, ?, ?, 0.0000, 0.0000, 'ACTIVE')`,
      [
        accountId,
        userId,
        accountNumber,
        accountType || 'Savings Account',
        currency || 'USD'
      ]
    );

    // 3. Provision Default Masked Visa Debit Card
    const cardLastFour = Math.floor(1000 + Math.random() * 9000);
    await conn.execute(
      `INSERT INTO cards (
        id, account_id, card_number_masked, card_holder_name, expiry_date, card_type, brand, status
      ) VALUES (?, ?, ?, ?, '12/30', 'DEBIT', 'VISA', 'ACTIVE')`,
      [
        cardId,
        accountId,
        `4111 •••• •••• ${cardLastFour}`,
        `${firstName.toUpperCase()} ${lastName.toUpperCase()}`
      ]
    );

    // 5. Log Audit Event
    await conn.execute(
      `INSERT INTO audit_logs (id, user_id, event_type, ip_address, user_agent, metadata)
       VALUES (?, ?, 'ACCOUNT_OPENED', ?, ?, ?)`,
      [
        uuidv4(),
        userId,
        getClientIp(req),
        req.headers['user-agent'] || 'Browser Client',
        JSON.stringify({ accountNumber, accountType, currency: currency || 'USD' })
      ]
    );

    await conn.commit();

    return res.status(201).json({
      success: true,
      status: 'SUCCESS',
      message: 'Your Obsidian Trust Bancorp account has been successfully provisioned.',
      accountNumber,
      currency: currency || 'USD',
      initialBalance: initialWelcomeDeposit
    });
  } catch (err) {
    await conn.rollback();
    console.error('Error in registration:', err);
    return res.status(500).json({
      success: false,
      status: 'REGISTRATION_ERROR',
      message: 'Failed to open account. Please try again or contact support.'
    });
  } finally {
    conn.release();
  }
}

// Current User Profile & Audit Context
async function getMe(req, res) {
  try {
    return res.status(200).json({
      success: true,
      status: 'SUCCESS',
      user: req.user
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      status: 'SERVER_ERROR',
      message: 'Failed to retrieve profile.'
    });
  }
}

// Dedicated Admin Login: Single-stage authentication restricted to administrative officers
async function adminLogin(req, res) {
  try {
    const { email, password } = req.body;
    const clientIp = req.clientIp || getClientIp(req);

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        status: 'REQUIRED_FIELD',
        message: 'Admin email and password are required.'
      });
    }

    const [rows] = await pool.execute(
      `SELECT id, role, first_name, last_name, email, password_hash, status 
       FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1`,
      [email.trim()]
    );

    if (!rows || rows.length === 0) {
      return res.status(401).json({
        success: false,
        status: 'INVALID_CREDENTIALS',
        message: 'Invalid administrative credentials.'
      });
    }

    const user = rows[0];

    // Enforce administrative role
    if (user.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        status: 'ACCESS_DENIED',
        message: 'Access Denied: Administrative credentials required. This portal is restricted to authorized bank officers.'
      });
    }

    if (user.status === 'SUSPENDED') {
      return res.status(403).json({
        success: false,
        status: 'SUSPENDED',
        message: 'This administrative account has been deactivated.'
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        status: 'INVALID_CREDENTIALS',
        message: 'Invalid administrative credentials.'
      });
    }

    // Generate Direct Admin Session JWT (24 Hours)
    const token = jwt.sign(
      { userId: user.id, role: 'ADMIN' },
      process.env.JWT_SECRET || 'otb_plc_prod_jwt_secret_key_obsidian_trust_bank_2026_super_secure',
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    // Update Last Login IP and Timestamp
    await pool.execute(
      `UPDATE users SET last_login_at = NOW(), last_login_ip = ? WHERE id = ?`,
      [clientIp, user.id]
    );

    // Log Audit Event
    await pool.execute(
      `INSERT INTO audit_logs (id, user_id, event_type, ip_address, user_agent, metadata)
       VALUES (?, ?, 'ADMIN_LOGIN_SUCCESS', ?, ?, ?)`,
      [
        uuidv4(),
        user.id,
        clientIp,
        req.headers['user-agent'] || 'Browser Client',
        JSON.stringify({ method: 'DIRECT_ADMIN_AUTH' })
      ]
    );

    return res.status(200).json({
      success: true,
      status: 'SUCCESS',
      message: 'Admin authorization successful.',
      token,
      user: {
        id: user.id,
        role: 'ADMIN',
        status: user.status,
        firstName: user.first_name,
        lastName: user.last_name,
        fullName: `${user.first_name} ${user.last_name}`,
        email: user.email,
        lastLoginIp: clientIp,
        lastLoginAt: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('Error in adminLogin:', err);
    return res.status(500).json({
      success: false,
      status: 'SERVER_ERROR',
      message: 'An unexpected error occurred during administrative authentication.'
    });
  }
}

// Update User Profile Details
async function updateProfile(req, res) {
  try {
    const userId = req.user.id;
    const { phone, address, city, state, zipCode, country, kycPhotoUrl } = req.body;

    await pool.execute(
      `UPDATE users 
       SET phone = COALESCE(?, phone),
           address = COALESCE(?, address),
           city = COALESCE(?, city),
           state = COALESCE(?, state),
           zip_code = COALESCE(?, zip_code),
           country = COALESCE(?, country),
           kyc_photo_url = COALESCE(?, kyc_photo_url)
       WHERE id = ?`,
      [
        phone !== undefined ? phone.trim() : null,
        address !== undefined ? address.trim() : null,
        city !== undefined ? city.trim() : null,
        state !== undefined ? state.trim() : null,
        zipCode !== undefined ? zipCode.trim() : null,
        country !== undefined ? country.trim() : null,
        kycPhotoUrl !== undefined ? kycPhotoUrl.trim() : null,
        userId
      ]
    );

    // Fetch refreshed user record
    const [rows] = await pool.execute(
      `SELECT id, role, first_name, last_name, email, phone, address, city, state, zip_code, country, kyc_photo_url, status
       FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );

    return res.status(200).json({
      success: true,
      message: 'Profile information updated successfully.',
      user: rows[0] || null
    });
  } catch (err) {
    console.error('Error in updateProfile:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to update profile information.'
    });
  }
}

module.exports = {
  loginStage1,
  verifyPinStage2,
  register,
  getMe,
  adminLogin,
  updateProfile
};
