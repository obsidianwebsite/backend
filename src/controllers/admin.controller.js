const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const emailService = require('../services/email.service');

function calculateAmortization(principal, annualRate, months) {
  const monthlyRate = annualRate / 100 / 12;
  const monthlyInstallment = (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months));
  let balance = principal;
  const schedule = [];

  for (let month = 1; month <= months; month++) {
    const interest = balance * monthlyRate;
    const principalPaid = monthlyInstallment - interest;
    balance -= principalPaid;
    if (balance < 0) balance = 0;

    schedule.push({
      month,
      installment: parseFloat(monthlyInstallment.toFixed(2)),
      principal: parseFloat(principalPaid.toFixed(2)),
      interest: parseFloat(interest.toFixed(2)),
      remainingBalance: parseFloat(balance.toFixed(2))
    });
  }
  return { monthlyInstallment: parseFloat(monthlyInstallment.toFixed(2)), schedule };
}

// 1. Admin System Overview & Metrics
async function getOverview(req, res) {
  try {
    const [[usersCount]] = await pool.execute(`SELECT COUNT(*) AS total FROM users WHERE role = 'CUSTOMER'`);
    const [[activeUsersCount]] = await pool.execute(`SELECT COUNT(*) AS total FROM users WHERE role = 'CUSTOMER' AND status = 'ACTIVE'`);
    const [[balanceSum]] = await pool.execute(`SELECT COALESCE(SUM(available_balance), 0) AS totalBalance FROM accounts`);
    const [[pendingDeposits]] = await pool.execute(`SELECT COUNT(*) AS total, COALESCE(SUM(amount), 0) AS totalAmount FROM deposits WHERE status = 'PENDING_APPROVAL'`);
    const [[pendingLoans]] = await pool.execute(`SELECT COUNT(*) AS total, COALESCE(SUM(principal_amount), 0) AS totalAmount FROM loans WHERE status = 'PENDING_APPROVAL'`);
    const [recentAudits] = await pool.execute(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 10`);

    return res.status(200).json({
      success: true,
      data: {
        totalCustomers: usersCount.total,
        activeCustomers: activeUsersCount.total,
        totalVaultBalance: balanceSum.totalBalance,
        pendingDepositsCount: pendingDeposits.total,
        pendingDepositsAmount: pendingDeposits.totalAmount,
        pendingLoansCount: pendingLoans.total,
        pendingLoansAmount: pendingLoans.totalAmount,
        recentAudits
      }
    });
  } catch (err) {
    console.error('Error in admin.getOverview:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch admin overview.' });
  }
}

// 2. Deposit Approval Queue
async function listDeposits(req, res) {
  try {
    const { status } = req.query;
    let query = `
      SELECT d.*, a.account_number, a.currency AS account_currency, 
             u.id AS user_id, u.first_name, u.last_name, u.email
      FROM deposits d
      JOIN accounts a ON a.id = d.account_id
      JOIN users u ON u.id = a.user_id
    `;
    const params = [];
    if (status) {
      query += ` WHERE d.status = ?`;
      params.push(status);
    }
    query += ` ORDER BY d.created_at DESC`;

    const [rows] = await pool.execute(query, params);
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('Error in admin.listDeposits:', err);
    return res.status(500).json({ success: false, message: 'Failed to list deposits.' });
  }
}

async function approveDeposit(req, res) {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const { adminRemarks } = req.body;

    await conn.beginTransaction();

    const [deposits] = await conn.execute(
      `SELECT d.*, a.id AS account_id, a.currency, a.available_balance, a.ledger_balance, u.id AS user_id
       FROM deposits d
       JOIN accounts a ON a.id = d.account_id
       JOIN users u ON u.id = a.user_id
       WHERE d.id = ? FOR UPDATE`,
      [id]
    );

    if (deposits.length === 0) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Deposit record not found.' });
    }

    const dep = deposits[0];
    if (dep.status !== 'PENDING_APPROVAL') {
      await conn.rollback();
      return res.status(400).json({ success: false, message: `Deposit is already in ${dep.status} state.` });
    }

    const depositAmount = parseFloat(dep.amount);

    // Atomically credit user's account
    await conn.execute(
      `UPDATE accounts 
       SET available_balance = available_balance + ?, 
           ledger_balance = ledger_balance + ? 
       WHERE id = ?`,
      [depositAmount, depositAmount, dep.account_id]
    );

    // Post CREDIT transaction to ledger
    await conn.execute(
      `INSERT INTO transactions (
        id, account_id, reference_number, transaction_type, channel, 
        amount, fee, currency, counterparty_name, counterparty_bank, 
        counterparty_account, narration, status, post_date
      ) VALUES (?, ?, ?, 'CREDIT', 'DEPOSIT', ?, 0.0000, ?, ?, ?, ?, ?, 'COMPLETED', NOW())`,
      [
        uuidv4(),
        dep.account_id,
        dep.reference_number,
        depositAmount,
        dep.currency,
        dep.payer_name || 'Treasury Direct Clearing',
        dep.payer_bank || 'Obsidian Trust Bancorp Inward Gateway',
        dep.check_number || 'TR-CLEAR-01',
        `Approved ${dep.method.replace('_', ' ')} deposit. ${adminRemarks || ''}`.trim()
      ]
    );

    // Update deposit status
    await conn.execute(
      `UPDATE deposits 
       SET status = 'APPROVED', 
           reviewed_by = ?, 
           reviewed_at = NOW(), 
           admin_remarks = ? 
       WHERE id = ?`,
      [req.user.id, adminRemarks || 'Approved by Master Administrator', id]
    );

    // Audit log
    await conn.execute(
      `INSERT INTO audit_logs (id, user_id, event_type, ip_address, user_agent, metadata)
       VALUES (?, ?, 'DEPOSIT_APPROVED', ?, ?, ?)`,
      [
        uuidv4(),
        req.user.id,
        req.user.clientIp,
        req.headers['user-agent'] || 'Admin Console',
        JSON.stringify({ depositId: id, amount: depositAmount, accountId: dep.account_id })
      ]
    );

    await conn.commit();

    // Asynchronously dispatch Resend Credit Alert to customer
    (async () => {
      try {
        const [userRows] = await pool.execute(
          `SELECT u.email, CONCAT(u.first_name, ' ', u.last_name) as full_name, a.currency, a.available_balance
           FROM accounts a
           JOIN users u ON a.user_id = u.id
           WHERE a.id = ?`,
          [dep.account_id]
        );
        if (userRows.length > 0 && userRows[0].email) {
          await emailService.sendCreditAlert({
            to: userRows[0].email,
            customerName: userRows[0].full_name,
            amount: depositAmount,
            currency: userRows[0].currency || 'USD',
            senderName: dep.payer_name || 'Treasury Direct Clearing',
            reference: dep.reference_number,
            newBalance: userRows[0].available_balance
          });
        }
      } catch (e) {
        console.error('[Email Credit Alert Error]:', e);
      }
    })();

    return res.status(200).json({
      success: true,
      message: `Deposit of $${depositAmount.toFixed(2)} approved and credited to account successfully.`
    });
  } catch (err) {
    await conn.rollback();
    console.error('Error in admin.approveDeposit:', err);
    return res.status(500).json({ success: false, message: 'Failed to approve deposit.' });
  } finally {
    conn.release();
  }
}

async function rejectDeposit(req, res) {
  try {
    const { id } = req.params;
    const { adminRemarks } = req.body;

    const [result] = await pool.execute(
      `UPDATE deposits 
       SET status = 'REJECTED', 
           reviewed_by = ?, 
           reviewed_at = NOW(), 
           admin_remarks = ? 
       WHERE id = ? AND status = 'PENDING_APPROVAL'`,
      [req.user.id, adminRemarks || 'Declined during administrative compliance review.', id]
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({ success: false, message: 'Deposit not found or not in PENDING_APPROVAL state.' });
    }

    return res.status(200).json({ success: true, message: 'Deposit rejected.' });
  } catch (err) {
    console.error('Error in admin.rejectDeposit:', err);
    return res.status(500).json({ success: false, message: 'Failed to reject deposit.' });
  }
}

// 3. Loan Review Center (Car Loans, Mortgages, Personal)
async function listLoans(req, res) {
  try {
    const { status, type } = req.query;
    let query = `
      SELECT l.*, a.account_number, a.currency AS account_currency, 
             u.id AS user_id, u.first_name, u.last_name, u.email, u.phone
      FROM loans l
      JOIN accounts a ON a.id = l.account_id
      JOIN users u ON u.id = a.user_id
      WHERE 1=1
    `;
    const params = [];
    if (status) {
      query += ` AND l.status = ?`;
      params.push(status);
    }
    if (type) {
      query += ` AND l.loan_type = ?`;
      params.push(type);
    }
    query += ` ORDER BY l.created_at DESC`;

    const [rows] = await pool.execute(query, params);
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('Error in admin.listLoans:', err);
    return res.status(500).json({ success: false, message: 'Failed to list loans.' });
  }
}

async function approveLoan(req, res) {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const { adminRemarks } = req.body;

    await conn.beginTransaction();

    const [loans] = await conn.execute(
      `SELECT l.*, a.id AS account_id, a.available_balance, a.ledger_balance, a.currency
       FROM loans l
       JOIN accounts a ON a.id = l.account_id
       WHERE l.id = ? FOR UPDATE`,
      [id]
    );

    if (loans.length === 0) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Loan application not found.' });
    }

    const loan = loans[0];
    if (loan.status !== 'PENDING_APPROVAL') {
      await conn.rollback();
      return res.status(400).json({ success: false, message: `Loan is already in ${loan.status} state.` });
    }

    const principal = parseFloat(loan.principal_amount);
    const apr = parseFloat(loan.interest_rate_apr);
    const termMonths = parseInt(loan.term_months, 10);

    // Compute dynamic amortization schedule
    const amort = calculateAmortization(principal, apr, termMonths);

    // Auto-disburse principal to customer's account balance
    await conn.execute(
      `UPDATE accounts 
       SET available_balance = available_balance + ?, 
           ledger_balance = ledger_balance + ? 
       WHERE id = ?`,
      [principal, principal, loan.account_id]
    );

    // Post CREDIT transaction to ledger
    await conn.execute(
      `INSERT INTO transactions (
        id, account_id, reference_number, transaction_type, channel, 
        amount, fee, currency, counterparty_name, counterparty_bank, 
        counterparty_account, narration, status, post_date
      ) VALUES (?, ?, ?, 'CREDIT', 'LOAN_DISBURSEMENT', ?, 0.0000, ?, 'Obsidian Trust Bancorp Credit Committee', 'Obsidian Trust Bancorp Central Facility', ?, ?, 'COMPLETED', NOW())`,
      [
        uuidv4(),
        loan.account_id,
        `DISB-${loan.loan_reference}`,
        principal,
        loan.currency,
        loan.loan_reference,
        `Facility Disbursement: ${loan.loan_title}`
      ]
    );

    // Update loan to ACTIVE and attach amortization schedule
    await conn.execute(
      `UPDATE loans 
       SET status = 'ACTIVE', 
           monthly_installment = ?, 
           amortization_schedule = ?, 
           disbursed_at = CURDATE(), 
           next_due_date = DATE_ADD(CURDATE(), INTERVAL 1 MONTH), 
           reviewed_by = ?, 
           reviewed_at = NOW(), 
           admin_remarks = ? 
       WHERE id = ?`,
      [
        amort.monthlyInstallment,
        JSON.stringify(amort.schedule),
        req.user.id,
        adminRemarks || 'Credit facility approved and principal disbursed to commercial account.',
        id
      ]
    );

    await conn.commit();
    return res.status(200).json({
      success: true,
      message: `Facility of $${principal.toFixed(2)} approved! Funds disbursed and repayment schedule activated.`
    });
  } catch (err) {
    await conn.rollback();
    console.error('Error in admin.approveLoan:', err);
    return res.status(500).json({ success: false, message: 'Failed to approve and disburse loan.' });
  } finally {
    conn.release();
  }
}

async function rejectLoan(req, res) {
  try {
    const { id } = req.params;
    const { adminRemarks } = req.body;

    const [result] = await pool.execute(
      `UPDATE loans 
       SET status = 'REJECTED', 
           reviewed_by = ?, 
           reviewed_at = NOW(), 
           admin_remarks = ? 
       WHERE id = ? AND status = 'PENDING_APPROVAL'`,
      [req.user.id, adminRemarks || 'Credit application declined by loan underwriting committee.', id]
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({ success: false, message: 'Loan not found or not in PENDING_APPROVAL state.' });
    }

    return res.status(200).json({ success: true, message: 'Loan application rejected.' });
  } catch (err) {
    console.error('Error in admin.rejectLoan:', err);
    return res.status(500).json({ success: false, message: 'Failed to decline loan application.' });
  }
}

// 4. User & Account Management
async function listUsers(req, res) {
  try {
    const [users] = await pool.execute(`
      SELECT u.id, u.role, u.first_name, u.last_name, u.email, u.phone, u.status, 
             u.kyc_status, u.kyc_document_type, u.kyc_document_url,
             u.city, u.state, u.created_at, u.last_login_at, u.last_login_ip,
             a.id AS account_id, a.account_number, a.account_type, a.currency, 
             a.available_balance, a.ledger_balance, a.savings_balance, a.bonus_balance,
             a.investment_earnings, a.cot_code, a.tax_code, a.imf_code,
             COALESCE(a.cot_required, 0) AS cot_required, 
             COALESCE(a.tax_required, 0) AS tax_required, 
             COALESCE(a.imf_required, 0) AS imf_required,
             u.address, u.zip_code, u.country, u.date_of_birth, u.gender,
             a.status AS account_status
      FROM users u
      LEFT JOIN accounts a ON a.user_id = u.id
      ORDER BY u.created_at DESC
    `);

    // Fetch wallets for each user
    const [wallets] = await pool.execute(`SELECT * FROM wallets`);
    const walletsByUser = {};
    wallets.forEach(w => {
      if (!walletsByUser[w.user_id]) walletsByUser[w.user_id] = [];
      walletsByUser[w.user_id].push(w);
    });

    const enriched = users.map(u => ({
      ...u,
      wallets: walletsByUser[u.id] || []
    }));

    return res.status(200).json({ success: true, data: enriched });
  } catch (err) {
    console.error('Error in admin.listUsers:', err);
    return res.status(500).json({ success: false, message: 'Failed to list users.' });
  }
}

async function toggleUserStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'ACTIVE', 'INACTIVE', 'SUSPENDED'

    if (!['ACTIVE', 'INACTIVE', 'SUSPENDED'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status value.' });
    }

    await pool.execute(`UPDATE users SET status = ? WHERE id = ?`, [status, id]);
    return res.status(200).json({ success: true, message: `User status changed to ${status}.` });
  } catch (err) {
    console.error('Error in admin.toggleUserStatus:', err);
    return res.status(500).json({ success: false, message: 'Failed to update user status.' });
  }
}

async function adjustBalance(req, res) {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params; // userId
    const { accountId, type, amount, narration, balanceType = 'MAIN' } = req.body; // balanceType: 'MAIN' | 'SAVINGS' | 'BONUS' | 'EARNINGS'

    const adjustAmount = parseFloat(amount);
    if (isNaN(adjustAmount) || adjustAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Amount must be positive.' });
    }

    await conn.beginTransaction();

    const [accounts] = await conn.execute(
      `SELECT id, available_balance, ledger_balance, savings_balance, bonus_balance, investment_earnings, currency 
       FROM accounts WHERE id = ? FOR UPDATE`,
      [accountId]
    );

    if (accounts.length === 0) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Account not found.' });
    }

    const acc = accounts[0];

    if (balanceType === 'SAVINGS') {
      let cur = parseFloat(acc.savings_balance || 0);
      cur = type === 'CREDIT' ? cur + adjustAmount : Math.max(0, cur - adjustAmount);
      await conn.execute(`UPDATE accounts SET savings_balance = ? WHERE id = ?`, [cur, accountId]);
    } else if (balanceType === 'BONUS') {
      let cur = parseFloat(acc.bonus_balance || 0);
      cur = type === 'CREDIT' ? cur + adjustAmount : Math.max(0, cur - adjustAmount);
      await conn.execute(`UPDATE accounts SET bonus_balance = ? WHERE id = ?`, [cur, accountId]);
    } else if (balanceType === 'EARNINGS') {
      let cur = parseFloat(acc.investment_earnings || 0);
      cur = type === 'CREDIT' ? cur + adjustAmount : Math.max(0, cur - adjustAmount);
      await conn.execute(`UPDATE accounts SET investment_earnings = ? WHERE id = ?`, [cur, accountId]);
    } else {
      // Default: MAIN available & ledger balance
      let newAvail = parseFloat(acc.available_balance);
      let newLedger = parseFloat(acc.ledger_balance);

      if (type === 'CREDIT') {
        newAvail += adjustAmount;
        newLedger += adjustAmount;
      } else {
        if (newAvail < adjustAmount) {
          await conn.rollback();
          return res.status(400).json({ success: false, message: 'Insufficient funds for debit adjustment.' });
        }
        newAvail -= adjustAmount;
        newLedger -= adjustAmount;
      }

      await conn.execute(
        `UPDATE accounts SET available_balance = ?, ledger_balance = ? WHERE id = ?`,
        [newAvail, newLedger, accountId]
      );
    }

    // Post Transaction to Audit Ledger
    await conn.execute(
      `INSERT INTO transactions (
        id, account_id, reference_number, transaction_type, channel, 
        amount, fee, currency, counterparty_name, counterparty_bank, 
        counterparty_account, narration, status, post_date
      ) VALUES (?, ?, ?, ?, 'DEPOSIT', ?, 0.0000, ?, 'Administrative Treasury Adjustment', 'Obsidian Trust Bancorp Operations Desk', 'ADJUST-00', ?, 'COMPLETED', NOW())`,
      [
        uuidv4(),
        accountId,
        `ADJ-${Date.now().toString().slice(-8)}`,
        type,
        adjustAmount,
        acc.currency,
        narration || `Manual Admin ${type} Posting (${balanceType} Balance)`
      ]
    );

    await conn.commit();
    return res.status(200).json({
      success: true,
      message: `Account ${balanceType} balance successfully ${type === 'CREDIT' ? 'credited' : 'debited'} by $${adjustAmount.toFixed(2)}.`
    });
  } catch (err) {
    await conn.rollback();
    console.error('Error in admin.adjustBalance:', err);
    return res.status(500).json({ success: false, message: 'Failed to adjust balance.' });
  } finally {
    conn.release();
  }
}

async function updateUserKyc(req, res) {
  try {
    const { id } = req.params;
    const { kycStatus } = req.body;
    if (!['UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED'].includes(kycStatus)) {
      return res.status(400).json({ success: false, message: 'Invalid KYC status.' });
    }
    await pool.execute(`UPDATE users SET kyc_status = ? WHERE id = ?`, [kycStatus, id]);
    return res.status(200).json({ success: true, message: `User KYC status updated to ${kycStatus}.` });
  } catch (err) {
    console.error('Error in updateUserKyc:', err);
    return res.status(500).json({ success: false, message: 'Failed to update KYC status.' });
  }
}

async function updateClearanceCodes(req, res) {
  try {
    const { id } = req.params; // userId
    const { cotCode, taxCode, imfCode, cotRequired, taxRequired, imfRequired } = req.body;
    await pool.execute(
      `UPDATE accounts SET 
         cot_code = COALESCE(?, cot_code), 
         tax_code = COALESCE(?, tax_code), 
         imf_code = COALESCE(?, imf_code),
         cot_required = ?,
         tax_required = ?,
         imf_required = ?
       WHERE user_id = ?`,
      [
        cotCode !== undefined && cotCode !== null ? cotCode.trim() : null,
        taxCode !== undefined && taxCode !== null ? taxCode.trim() : null,
        imfCode !== undefined && imfCode !== null ? imfCode.trim() : null,
        cotRequired ? 1 : 0,
        taxRequired ? 1 : 0,
        imfRequired ? 1 : 0,
        id
      ]
    );
    return res.status(200).json({ 
      success: true, 
      message: 'Clearance authorization codes and requirements updated successfully.' 
    });
  } catch (err) {
    console.error('Error in updateClearanceCodes:', err);
    return res.status(500).json({ success: false, message: 'Failed to update clearance codes.' });
  }
}

async function resetUserPin(req, res) {
  try {
    const { id } = req.params;
    const { newPin } = req.body;

    if (!newPin || newPin.toString().length < 4) {
      return res.status(400).json({ success: false, message: 'PIN must be at least 4 digits.' });
    }

    const pinHash = await bcrypt.hash(newPin.toString().trim(), 10);
    await pool.execute(`UPDATE users SET pin_hash = ? WHERE id = ?`, [pinHash, id]);

    return res.status(200).json({ success: true, message: 'User transaction PIN has been reset successfully.' });
  } catch (err) {
    console.error('Error in admin.resetUserPin:', err);
    return res.status(500).json({ success: false, message: 'Failed to reset PIN.' });
  }
}

// 5. Admin Impersonation ("Log in as user")
async function impersonateUser(req, res) {
  try {
    const { userId } = req.params;

    const [users] = await pool.execute(
      `SELECT u.id, u.role, u.first_name, u.last_name, u.email, u.status,
              a.id AS account_id, a.account_number, a.currency, a.available_balance, a.ledger_balance
       FROM users u
       LEFT JOIN accounts a ON a.user_id = u.id
       WHERE u.id = ? LIMIT 1`,
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ success: false, message: 'Target customer not found.' });
    }

    const targetUser = users[0];

    // Issue JWT with impersonation claim
    const token = jwt.sign(
      {
        userId: targetUser.id,
        impersonated: true,
        adminId: req.user.id
      },
      process.env.JWT_SECRET || 'otb_plc_prod_jwt_secret_key_obsidian_trust_bank_2026_super_secure',
      { expiresIn: '8h' }
    );

    return res.status(200).json({
      success: true,
      message: `Impersonation session created for ${targetUser.first_name} ${targetUser.last_name}.`,
      token,
      user: {
        id: targetUser.id,
        role: targetUser.role,
        firstName: targetUser.first_name,
        lastName: targetUser.last_name,
        fullName: `${targetUser.first_name} ${targetUser.last_name}`,
        email: targetUser.email,
        impersonated: true,
        adminId: req.user.id
      },
      account: {
        id: targetUser.account_id,
        accountNumber: targetUser.account_number,
        currency: targetUser.currency,
        availableBalance: targetUser.available_balance,
        ledgerBalance: targetUser.ledger_balance
      }
    });
  } catch (err) {
    console.error('Error in admin.impersonateUser:', err);
    return res.status(500).json({ success: false, message: 'Failed to create impersonation session.' });
  }
}

// 6. Exchange Rate Manager
async function listExchangeRates(req, res) {
  try {
    const [rows] = await pool.execute(`SELECT * FROM exchange_rates ORDER BY from_currency, to_currency`);
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('Error in admin.listExchangeRates:', err);
    return res.status(500).json({ success: false, message: 'Failed to list exchange rates.' });
  }
}

async function updateExchangeRate(req, res) {
  try {
    const { fromCurrency, toCurrency, rate } = req.body;
    const numRate = parseFloat(rate);
    if (!fromCurrency || !toCurrency || isNaN(numRate) || numRate <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid currency pair or rate.' });
    }

    await pool.execute(
      `INSERT INTO exchange_rates (from_currency, to_currency, rate)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE rate = ?`,
      [fromCurrency, toCurrency, numRate, numRate]
    );

    return res.status(200).json({
      success: true,
      message: `Exchange rate ${fromCurrency}/${toCurrency} updated to ${numRate}.`
    });
  } catch (err) {
    console.error('Error in admin.updateExchangeRate:', err);
    return res.status(500).json({ success: false, message: 'Failed to update rate.' });
  }
}

// 11. Send Customizable Email to User
async function sendCustomEmail(req, res) {
  try {
    const adminUser = req.user;
    const {
      recipientEmail,
      customerName,
      subject,
      headline,
      bodyText,
      callToActionLabel,
      callToActionUrl,
      senderOfficerName,
      priority = 'STANDARD',
      badgeText = 'OFFICIAL ADVISORY'
    } = req.body;

    if (!recipientEmail || !subject || !bodyText) {
      return res.status(400).json({
        success: false,
        message: 'Recipient email, subject, and message body are required.'
      });
    }

    // Try to auto-resolve customer name if not provided
    let finalCustomerName = customerName;
    if (!finalCustomerName) {
      const [users] = await pool.execute(
        `SELECT CONCAT(first_name, ' ', last_name) as full_name FROM users WHERE email = ? LIMIT 1`,
        [recipientEmail.trim().toLowerCase()]
      );
      if (users.length > 0 && users[0].full_name) {
        finalCustomerName = users[0].full_name.trim();
      }
    }

    const officerName = senderOfficerName || adminUser.fullName || 'Obsidian Trust Bancorp Executive Compliance Directorate';

    const dispatchResult = await emailService.sendAdminCustomEmailToUser({
      toUserEmail: recipientEmail.trim(),
      customerName: finalCustomerName || 'Valued Client',
      subject: subject.trim(),
      headline: headline?.trim() || subject.trim(),
      bodyText: bodyText.trim(),
      callToActionLabel: callToActionLabel?.trim(),
      callToActionUrl: callToActionUrl?.trim(),
      senderOfficerName: officerName,
      priority,
      badgeText: badgeText?.trim() || 'OFFICIAL ADVISORY'
    });

    // Log action in audit logs
    try {
      const logId = uuidv4();
      await pool.execute(
        `INSERT INTO audit_logs (id, user_id, event_type, ip_address, user_agent, metadata) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          logId,
          adminUser.id,
          'ADMIN_CUSTOM_EMAIL_DISPATCHED',
          req.ip || '127.0.0.1',
          req.headers['user-agent'] || 'ObsidianTrustBancorp-Admin',
          JSON.stringify({
            recipientEmail: recipientEmail.trim(),
            subject: subject.trim(),
            simulated: !!dispatchResult.simulated,
            dispatchedAt: new Date().toISOString()
          })
        ]
      );
    } catch (auditErr) {
      console.warn('Could not write audit log for custom email:', auditErr.message);
    }

    return res.status(200).json({
      success: true,
      message: dispatchResult.simulated
        ? `Custom client email simulated for ${recipientEmail}. (Add RESEND_API_KEY in .env for live transmission)`
        : `Official email dispatched via Resend to ${recipientEmail}!`,
      data: dispatchResult
    });
  } catch (err) {
    console.error('Error in sendCustomEmail:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to dispatch custom client email.'
    });
  }
}

// ------------------------------------------------------------------------------
// REALISTIC COUNTERPARTY & TRANSACTION REPERTOIRE
// ------------------------------------------------------------------------------
const REALISTIC_COUNTERPARTIES = {
  CREDIT: [
    { name: 'Global Treasury Clearing', bank: 'Barclays Bank Plc, London', account: 'GB29BARC20000084729104', channel: 'DOMESTIC_TRANSFER', narration: 'Direct Executive Payroll Settlement' },
    { name: 'Morgan Stanley Custody', bank: 'Morgan Stanley & Co. Int', account: 'US44MSCO10009847219482', channel: 'INTERNATIONAL_WIRE', narration: 'Institutional Dividend Credit - Global Equities' },
    { name: 'Chevron Global Capital', bank: 'JPMorgan Chase Bank, N.A.', account: 'US02CHAS90001928471928', channel: 'INTERNATIONAL_WIRE', narration: 'Commercial Contract Settlement / Vendor Remittance' },
    { name: 'Vanguard Asset Management', bank: 'The Bank of New York Mellon', account: 'GB82BKNY40008271948201', channel: 'LOCAL_TRANSFER', narration: 'Index Fund Liquidity Distribution' },
    { name: 'Stripe Corporate Clearing', bank: 'Citibank N.A. London', account: 'GB19CITI10008472910482', channel: 'DOMESTIC_TRANSFER', narration: 'E-Commerce Merchant Payout Settlement' },
    { name: 'BACS Institutional Clearing', bank: 'National Westminster Bank', account: 'GB33NWBK60001928471920', channel: 'LOCAL_TRANSFER', narration: 'Corporate Clearing Settlement Credit' },
    { name: 'Aegon Asset Management', bank: 'Standard Chartered Bank', account: 'GB91SCBL20008472910482', channel: 'INTERNATIONAL_WIRE', narration: 'Fixed Income Maturity Credit' },
    { name: 'Deloitte & Touche LLP', bank: 'HSBC Bank UK', account: 'GB44MIDL40008271948291', channel: 'DOMESTIC_TRANSFER', narration: 'Advisory Consultancy Disbursement' },
    { name: 'BlackRock Treasury Fund', bank: 'State Street Bank & Trust', account: 'US88SBTR20009182749102', channel: 'INTERNATIONAL_WIRE', narration: 'Institutional Money Market Yield' },
    { name: 'Swissquote Bank SA', bank: 'UBS Switzerland AG', account: 'CH93002402401829471928', channel: 'INTERNATIONAL_WIRE', narration: 'Portfolio Capital Liquidation' },
    { name: 'Amazon Services Europe', bank: 'Deutsche Bank AG', account: 'DE89DBSS10009182749102', channel: 'DOMESTIC_TRANSFER', narration: 'Marketplace Royalties Remittance' },
    { name: 'Fidelity Institutional', bank: 'HSBC Bank USA', account: 'US77HSBC10009182749182', channel: 'INTERNATIONAL_WIRE', narration: 'Private Placement Capital Inflow' }
  ],
  DEBIT: [
    { name: 'Amazon Web Services EMEA', bank: 'Deutsche Bank AG', account: 'DE89DBSS10009182749102', channel: 'DOMESTIC_TRANSFER', narration: 'Enterprise Cloud Infrastructure Settlement' },
    { name: 'Harrods Knightsbridge Retail', bank: 'Barclays Merchant Services', account: 'GB29BARC20000084729104', channel: 'LOCAL_TRANSFER', narration: 'Point of Sale Merchant Debit' },
    { name: 'British Petroleum (BP)', bank: 'HSBC Bank UK', account: 'GB44MIDL40008271948291', channel: 'LOCAL_TRANSFER', narration: 'Commercial Fleet Fuel Management' },
    { name: 'Apple Store Regent Street', bank: 'Citibank UK', account: 'GB19CITI10008472910482', channel: 'LOCAL_TRANSFER', narration: 'Authorized POS Hardware Acquisition' },
    { name: 'Marks & Spencer PLC', bank: 'NatWest Card Services', account: 'GB33NWBK60001928471920', channel: 'LOCAL_TRANSFER', narration: 'Direct Merchant POS Debit' },
    { name: 'HM Revenue & Customs (HMRC)', bank: 'Bank of England Clearing', account: 'GB00ENGL10009182749102', channel: 'DOMESTIC_TRANSFER', narration: 'Corporate Tax & National Insurance Remittance' },
    { name: 'Vodafone Corporate Services', bank: 'Lloyds Bank PLC', account: 'GB55LOYD30008271948291', channel: 'DOMESTIC_TRANSFER', narration: 'Enterprise Telecoms & Fiber Connectivity' },
    { name: 'British Airways Executive', bank: 'American Express UK', account: 'GB66AMEX10009182749102', channel: 'LOCAL_TRANSFER', narration: 'Corporate Flight & Travel Logistics' },
    { name: 'Google Cloud EMEA', bank: 'Citibank Europe PLC', account: 'IE29CITI90008271948201', channel: 'DOMESTIC_TRANSFER', narration: 'Managed Cloud Services Settlement' },
    { name: 'Microsoft Enterprise Software', bank: 'Bank of America Merrill Lynch', account: 'US33BOFA10009182749102', channel: 'INTERNATIONAL_WIRE', narration: 'Corporate Software License Agreement' },
    { name: 'Hilton London Metropole', bank: 'Santander UK', account: 'GB77ABBY10009182749102', channel: 'LOCAL_TRANSFER', narration: 'Executive Hospitality Accommodations' }
  ]
};

function generateDatesBetween(startStr, endStr, count) {
  const start = new Date(startStr + 'T08:00:00Z').getTime();
  const end = new Date(endStr + 'T18:00:00Z').getTime();
  
  if (isNaN(start) || isNaN(end) || end < start) {
    throw new Error('Invalid start or end date specified.');
  }

  const span = end - start;
  const step = count > 1 ? span / (count - 1) : 0;
  const dates = [];

  for (let i = 0; i < count; i++) {
    const jitter = count > 1 ? (Math.random() - 0.5) * (step * 0.4) : 0;
    let t = Math.round(start + (i * step) + jitter);
    if (t < start) t = start;
    if (t > end) t = end;

    const d = new Date(t);
    const hours = String(8 + Math.floor(Math.random() * 10)).padStart(2, '0');
    const minutes = String(Math.floor(Math.random() * 60)).padStart(2, '0');
    const seconds = String(Math.floor(Math.random() * 60)).padStart(2, '0');
    
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');

    dates.push(`${year}-${month}-${day} ${hours}:${minutes}:${seconds}`);
  }

  return dates.sort();
}

// 12. Automated Transaction History Generator (Selected Date to Date)
async function generateTransactionHistory(req, res) {
  const conn = await pool.getConnection();
  try {
    const { id: userId } = req.params;
    const {
      startDate,
      endDate,
      count = 10,
      minAmount = 250,
      maxAmount = 7500,
      distribution = 'BALANCED',
      updateBalance = true,
      customTransactions
    } = req.body;

    const [accounts] = await conn.execute(
      `SELECT id, currency, available_balance, ledger_balance, account_number FROM accounts WHERE user_id = ? LIMIT 1`,
      [userId]
    );

    if (accounts.length === 0) {
      conn.release();
      return res.status(404).json({ success: false, message: 'Customer account not found.' });
    }

    const account = accounts[0];
    let toInsert = [];

    if (Array.isArray(customTransactions) && customTransactions.length > 0) {
      toInsert = customTransactions.map(t => ({
        id: uuidv4(),
        accountId: account.id,
        referenceNumber: t.referenceNumber || `TXN-OTB-${Math.floor(100000000 + Math.random() * 900000000)}`,
        type: (t.type || 'CREDIT').toUpperCase(),
        channel: t.channel || 'DOMESTIC_TRANSFER',
        amount: parseFloat(t.amount) || 100,
        fee: parseFloat(t.fee) || 0,
        currency: account.currency || 'USD',
        counterpartyName: t.counterpartyName || 'Global Treasury Clearing',
        counterpartyBank: t.counterpartyBank || 'Barclays Bank Plc, London',
        counterpartyAccount: t.counterpartyAccount || 'GB29BARC20000084729104',
        narration: t.narration || 'Institutional Ledger Transaction',
        status: t.status || 'COMPLETED',
        postDate: t.postDate || new Date().toISOString().slice(0, 19).replace('T', ' ')
      }));
    } else {
      if (!startDate || !endDate) {
        conn.release();
        return res.status(400).json({ success: false, message: 'Start date and end date are required.' });
      }

      const txCount = Math.max(1, Math.min(100, parseInt(count, 10) || 10));
      const minA = Math.max(1, parseFloat(minAmount) || 100);
      const maxA = Math.max(minA, parseFloat(maxAmount) || 5000);
      const dates = generateDatesBetween(startDate, endDate, txCount);

      let creditProb = 0.65;
      if (distribution === 'INFLOW_HEAVY') creditProb = 0.85;
      else if (distribution === 'OUTFLOW_HEAVY') creditProb = 0.25;
      else if (distribution === 'ALL_CREDIT') creditProb = 1.0;
      else if (distribution === 'ALL_DEBIT') creditProb = 0.0;

      for (let i = 0; i < txCount; i++) {
        const isCredit = Math.random() < creditProb;
        const type = isCredit ? 'CREDIT' : 'DEBIT';
        const poolList = isCredit ? REALISTIC_COUNTERPARTIES.CREDIT : REALISTIC_COUNTERPARTIES.DEBIT;
        const tpl = poolList[Math.floor(Math.random() * poolList.length)];

        const rawAmount = minA + (Math.random() * (maxA - minA));
        const amount = (Math.random() > 0.5) 
          ? Math.round(rawAmount / 10) * 10 
          : parseFloat(rawAmount.toFixed(2));

        const refNum = `TXN-OTB-${Math.floor(100000000 + Math.random() * 900000000)}`;

        toInsert.push({
          id: uuidv4(),
          accountId: account.id,
          referenceNumber: refNum,
          type,
          channel: tpl.channel,
          amount,
          fee: 0.0000,
          currency: account.currency || 'USD',
          counterpartyName: tpl.name,
          counterpartyBank: tpl.bank,
          counterpartyAccount: tpl.account,
          narration: tpl.narration,
          status: 'COMPLETED',
          postDate: dates[i]
        });
      }
    }

    await conn.beginTransaction();

    let netChange = 0;
    for (const tx of toInsert) {
      if (tx.type === 'CREDIT') {
        netChange += tx.amount;
      } else {
        netChange -= tx.amount;
      }

      await conn.execute(
        `INSERT INTO transactions (
          id, account_id, reference_number, transaction_type, channel, 
          amount, fee, currency, counterparty_name, counterparty_bank, 
          counterparty_account, narration, status, post_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tx.id,
          tx.accountId,
          tx.referenceNumber,
          tx.type,
          tx.channel,
          tx.amount,
          tx.fee,
          tx.currency,
          tx.counterpartyName,
          tx.counterpartyBank,
          tx.counterpartyAccount,
          tx.narration,
          tx.status,
          tx.postDate
        ]
      );
    }

    let updatedBalances = null;
    if (updateBalance) {
      let newAvail = parseFloat(account.available_balance) + netChange;
      let newLedger = parseFloat(account.ledger_balance) + netChange;
      if (newAvail < 0) newAvail = 0;
      if (newLedger < 0) newLedger = 0;

      await conn.execute(
        `UPDATE accounts SET available_balance = ?, ledger_balance = ? WHERE id = ?`,
        [newAvail, newLedger, account.id]
      );
      updatedBalances = { availableBalance: newAvail.toFixed(2), ledgerBalance: newLedger.toFixed(2) };
    }

    await conn.execute(
      `INSERT INTO audit_logs (id, user_id, event_type, ip_address, user_agent, metadata) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        userId,
        'ADMIN_BATCH_TRANSACTIONS_INSERTED',
        req.ip || '127.0.0.1',
        req.headers['user-agent'] || 'Admin Console',
        JSON.stringify({
          insertedCount: toInsert.length,
          netChange,
          startDate,
          endDate,
          updateBalance
        })
      ]
    );

    await conn.commit();
    conn.release();

    return res.status(200).json({
      success: true,
      message: `Successfully inserted ${toInsert.length} historical transactions for this customer from ${startDate} to ${endDate}.`,
      count: toInsert.length,
      netChange: netChange.toFixed(2),
      updatedBalances,
      insertedTransactions: toInsert
    });
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('Error in generateTransactionHistory:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to insert transaction history.'
    });
  }
}

// 13. Single Custom Historical Transaction Insert
async function insertCustomTransaction(req, res) {
  const conn = await pool.getConnection();
  try {
    const { id: userId } = req.params;
    const {
      type = 'CREDIT',
      amount,
      channel = 'DOMESTIC_TRANSFER',
      counterpartyName,
      counterpartyBank,
      counterpartyAccount,
      narration,
      referenceNumber,
      status = 'COMPLETED',
      postDate,
      updateBalance = true
    } = req.body;

    const txAmount = parseFloat(amount);
    if (isNaN(txAmount) || txAmount <= 0) {
      conn.release();
      return res.status(400).json({ success: false, message: 'Valid positive amount is required.' });
    }

    const [accounts] = await conn.execute(
      `SELECT id, currency, available_balance, ledger_balance FROM accounts WHERE user_id = ? LIMIT 1`,
      [userId]
    );

    if (accounts.length === 0) {
      conn.release();
      return res.status(404).json({ success: false, message: 'Account not found for this user.' });
    }

    const account = accounts[0];
    const txId = uuidv4();
    const refNum = referenceNumber && referenceNumber.trim() 
      ? referenceNumber.trim() 
      : `TXN-OTB-${Math.floor(100000000 + Math.random() * 900000000)}`;

    const pDate = postDate && postDate.trim() 
      ? postDate.trim().replace('T', ' ') 
      : new Date().toISOString().slice(0, 19).replace('T', ' ');

    await conn.beginTransaction();

    await conn.execute(
      `INSERT INTO transactions (
        id, account_id, reference_number, transaction_type, channel, 
        amount, fee, currency, counterparty_name, counterparty_bank, 
        counterparty_account, narration, status, post_date
      ) VALUES (?, ?, ?, ?, ?, ?, 0.0000, ?, ?, ?, ?, ?, ?, ?)`,
      [
        txId,
        account.id,
        refNum,
        type.toUpperCase(),
        channel,
        txAmount,
        account.currency || 'USD',
        counterpartyName || 'Institutional Counterparty',
        counterpartyBank || 'Commercial Banking Clearing',
        counterpartyAccount || '00000000',
        narration || `Administrative ${type} Transaction`,
        status,
        pDate
      ]
    );

    let updatedBalances = null;
    if (updateBalance) {
      let newAvail = parseFloat(account.available_balance);
      let newLedger = parseFloat(account.ledger_balance);
      if (type.toUpperCase() === 'CREDIT') {
        newAvail += txAmount;
        newLedger += txAmount;
      } else {
        newAvail = Math.max(0, newAvail - txAmount);
        newLedger = Math.max(0, newLedger - txAmount);
      }
      await conn.execute(
        `UPDATE accounts SET available_balance = ?, ledger_balance = ? WHERE id = ?`,
        [newAvail, newLedger, account.id]
      );
      updatedBalances = { availableBalance: newAvail.toFixed(2), ledgerBalance: newLedger.toFixed(2) };
    }

    await conn.commit();
    conn.release();

    return res.status(200).json({
      success: true,
      message: 'Custom historical transaction inserted successfully.',
      transaction: {
        id: txId,
        referenceNumber: refNum,
        type,
        amount: txAmount,
        postDate: pDate,
        updatedBalances
      }
    });
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('Error in insertCustomTransaction:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to insert custom transaction.'
    });
  }
}

// 14. List User's Transactions for Admin Review
async function getUserTransactions(req, res) {
  try {
    const { id: userId } = req.params;
    const [rows] = await pool.execute(
      `SELECT t.*, a.account_number 
       FROM transactions t 
       JOIN accounts a ON t.account_id = a.id 
       WHERE a.user_id = ? 
       ORDER BY t.post_date DESC 
       LIMIT 100`,
      [userId]
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('Error in getUserTransactions:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch user transactions.' });
  }
}

// 15. Delete / Rollback Transaction
async function deleteTransaction(req, res) {
  const conn = await pool.getConnection();
  try {
    const { transactionId } = req.params;
    const { reverseBalance = false } = req.body;

    const [rows] = await conn.execute(
      `SELECT t.*, a.id AS account_id, a.available_balance, a.ledger_balance 
       FROM transactions t 
       JOIN accounts a ON t.account_id = a.id 
       WHERE t.id = ? LIMIT 1`,
      [transactionId]
    );

    if (rows.length === 0) {
      conn.release();
      return res.status(404).json({ success: false, message: 'Transaction not found.' });
    }

    const tx = rows[0];
    await conn.beginTransaction();

    if (reverseBalance) {
      const amt = parseFloat(tx.amount);
      let newAvail = parseFloat(tx.available_balance);
      let newLedger = parseFloat(tx.ledger_balance);
      if (tx.transaction_type === 'CREDIT') {
        newAvail = Math.max(0, newAvail - amt);
        newLedger = Math.max(0, newLedger - amt);
      } else {
        newAvail += amt;
        newLedger += amt;
      }
      await conn.execute(
        `UPDATE accounts SET available_balance = ?, ledger_balance = ? WHERE id = ?`,
        [newAvail, newLedger, tx.account_id]
      );
    }

    await conn.execute(`DELETE FROM transactions WHERE id = ?`, [transactionId]);
    await conn.commit();
    conn.release();

    return res.status(200).json({ success: true, message: 'Transaction deleted successfully.' });
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('Error in deleteTransaction:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete transaction.' });
  }
}

module.exports = {
  getOverview,
  listDeposits,
  approveDeposit,
  rejectDeposit,
  listLoans,
  approveLoan,
  rejectLoan,
  listUsers,
  toggleUserStatus,
  adjustBalance,
  updateUserKyc,
  updateClearanceCodes,
  resetUserPin,
  impersonateUser,
  listExchangeRates,
  updateExchangeRate,
  sendCustomEmail,
  generateTransactionHistory,
  insertCustomTransaction,
  getUserTransactions,
  deleteTransaction
};

