const jwt = require('jsonwebtoken');
const pool = require('../config/db');

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || '127.0.0.1';
}

// Stage 2 & Protected Routes: Verify full session JWT
async function verifyAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        status: 'UNAUTHORIZED',
        message: 'Access denied. Valid Bearer authorization token is required.'
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(
      token, 
      process.env.JWT_SECRET || 'otb_plc_prod_jwt_secret_key_obsidian_trust_bank_2026_super_secure'
    );

    // Fetch user and primary account (LEFT JOIN allows Admin users without direct customer accounts)
    const [users] = await pool.execute(
      `SELECT u.id, u.role, u.first_name, u.last_name, u.email, u.phone, u.status, 
              u.last_login_at, u.last_login_ip, u.kyc_photo_url,
              a.id AS account_id, a.account_number, a.account_type, a.currency, 
              a.available_balance, a.ledger_balance, a.status AS account_status
       FROM users u
       LEFT JOIN accounts a ON a.user_id = u.id
       WHERE u.id = ? LIMIT 1`,
      [decoded.userId]
    );

    if (!users || users.length === 0) {
      return res.status(401).json({
        success: false,
        status: 'USER_NOT_FOUND',
        message: 'User account could not be found.'
      });
    }

    const user = users[0];

    if (user.status === 'SUSPENDED') {
      return res.status(403).json({
        success: false,
        status: 'SUSPENDED',
        message: 'Your account has been suspended. Please contact customer support.'
      });
    }

    req.user = {
      id: user.id,
      role: user.role || 'CUSTOMER',
      status: user.status,
      impersonated: !!decoded.impersonated,
      adminId: decoded.adminId || null,
      firstName: user.first_name,
      lastName: user.last_name,
      fullName: `${user.first_name} ${user.last_name}`,
      email: user.email,
      phone: user.phone,
      kycPhotoUrl: user.kyc_photo_url,
      lastLoginAt: user.last_login_at,
      lastLoginIp: user.last_login_ip,
      clientIp: getClientIp(req),
      account: user.account_id ? {
        id: user.account_id,
        accountNumber: user.account_number,
        accountType: user.account_type,
        currency: user.currency,
        availableBalance: user.available_balance,
        ledgerBalance: user.ledger_balance,
        status: user.account_status
      } : null
    };

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        status: 'TOKEN_EXPIRED',
        message: 'Your banking session has expired. Please log in again.'
      });
    }
    return res.status(401).json({
      success: false,
      status: 'INVALID_TOKEN',
      message: 'Invalid session token.'
    });
  }
}

// Stage 1 to Stage 2: Verify Pre-Auth Token (Temporary for PIN Challenge)
async function verifyPreAuth(req, res, next) {
  try {
    const bearerToken = req.headers.authorization && req.headers.authorization.startsWith('Bearer ') 
      ? req.headers.authorization.split(' ')[1] 
      : null;
    const preAuthToken = req.body.preAuthToken || req.headers['x-preauth-token'] || bearerToken;
    if (!preAuthToken) {
      return res.status(400).json({
        success: false,
        status: 'PREAUTH_REQUIRED',
        message: 'Stage 1 Pre-Auth token is required to verify PIN.'
      });
    }

    const decoded = jwt.verify(
      preAuthToken, 
      process.env.JWT_PREAUTH_SECRET || 'otb_plc_stage1_preauth_token_key_2026_temporary'
    );

    const [users] = await pool.execute(
      `SELECT id, role, first_name, last_name, email, pin_hash, status 
       FROM users WHERE id = ? LIMIT 1`,
      [decoded.userId]
    );

    if (!users || users.length === 0) {
      return res.status(404).json({
        success: false,
        status: 'USER_NOT_FOUND',
        message: 'Account not found.'
      });
    }

    if (users[0].status === 'SUSPENDED') {
      return res.status(403).json({
        success: false,
        status: 'SUSPENDED',
        message: 'Your account has been suspended. Please contact customer support.'
      });
    }

    req.preAuthUser = users[0];
    req.clientIp = getClientIp(req);
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      status: 'PREAUTH_EXPIRED',
      message: 'Authentication session expired. Please enter your email and password again.'
    });
  }
}

// Transaction Guard: Prevent INACTIVE, DORMANT, or FROZEN accounts from executing financial transactions
function requireActiveAccount(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      status: 'UNAUTHORIZED',
      message: 'Access denied. Valid Bearer authorization token is required.'
    });
  }

  const isInactive = req.user.status === 'INACTIVE' || 
                     req.user.account?.status === 'DORMANT' || 
                     req.user.account?.status === 'FROZEN' || 
                     req.user.account?.status === 'CLOSED';

  if (isInactive) {
    return res.status(403).json({
      success: false,
      status: 'ACCOUNT_INACTIVE',
      message: 'This account is currently inactive. Deposits, transfers, and withdrawals are disabled. Kindly contact customer support.'
    });
  }

  if (req.user.status === 'SUSPENDED') {
    return res.status(403).json({
      success: false,
      status: 'ACCOUNT_SUSPENDED',
      message: 'This account is suspended. All transactional operations are restricted.'
    });
  }

  next();
}

// Master Admin Authorization Guard
function verifyAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'ADMIN') {
    return res.status(403).json({
      success: false,
      status: 'FORBIDDEN',
      message: 'Access restricted to Master System Administrators only.'
    });
  }
  next();
}

module.exports = {
  verifyAuth,
  verifyPreAuth,
  requireActiveAccount,
  verifyAdmin,
  getClientIp
};
