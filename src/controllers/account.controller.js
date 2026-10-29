const pool = require('../config/db');

// Account Overview & Summary Metrics for Dashboard
async function getSummary(req, res) {
  try {
    const accountId = req.user.account.id;

    // Fetch refreshed account balance with multi-balance and clearance metrics
    const [accRows] = await pool.execute(
      `SELECT a.id, a.account_number, a.account_type, a.currency, a.available_balance, a.ledger_balance, 
              a.savings_balance, a.bonus_balance, a.investment_earnings, a.cot_code, a.tax_code, a.imf_code,
              COALESCE(a.cot_required, 0) AS cot_required,
              COALESCE(a.tax_required, 0) AS tax_required,
              COALESCE(a.imf_required, 0) AS imf_required,
              a.status,
              u.status AS user_status, u.kyc_status, u.kyc_document_type
       FROM accounts a
       JOIN users u ON u.id = a.user_id
       WHERE a.id = ? LIMIT 1`,
      [accountId]
    );

    const account = accRows[0] || req.user.account;

    // Fetch recent 5 transactions
    const [recentTransactions] = await pool.execute(
      `SELECT id, reference_number, transaction_type, channel, amount, fee, currency, 
              counterparty_name, counterparty_bank, counterparty_account, narration, status, post_date
       FROM transactions 
       WHERE account_id = ? 
       ORDER BY post_date DESC 
       LIMIT 5`,
      [accountId]
    );

    // Compute aggregate metrics
    const [aggregates] = await pool.execute(
      `SELECT 
        COALESCE(SUM(CASE WHEN transaction_type = 'CREDIT' THEN amount ELSE 0 END), 0) AS total_inflow,
        COALESCE(SUM(CASE WHEN transaction_type = 'DEBIT' THEN amount ELSE 0 END), 0) AS total_outflow,
        COUNT(id) AS total_transactions
       FROM transactions
       WHERE account_id = ?`,
      [accountId]
    );

    // Count active cards & loans
    const [[{ active_cards }]] = await pool.execute(
      `SELECT COUNT(id) AS active_cards FROM cards WHERE account_id = ? AND status = 'ACTIVE'`,
      [accountId]
    );

    const [[{ active_loans }]] = await pool.execute(
      `SELECT COUNT(id) AS active_loans FROM loans WHERE account_id = ? AND status = 'ACTIVE'`,
      [accountId]
    );

    return res.status(200).json({
      success: true,
      status: 'SUCCESS',
      data: {
        account: {
          id: account.id,
          accountNumber: account.account_number,
          accountType: account.account_type,
          currency: account.currency,
          availableBalance: parseFloat(account.available_balance).toFixed(2),
          ledgerBalance: parseFloat(account.ledger_balance).toFixed(2),
          savingsBalance: parseFloat(account.savings_balance || 0).toFixed(2),
          bonusBalance: parseFloat(account.bonus_balance || 0).toFixed(2),
          investmentEarnings: parseFloat(account.investment_earnings || 0).toFixed(2),
          cotCode: account.cot_code || 'COT-7749',
          taxCode: account.tax_code || 'TAX-8821',
          imfCode: account.imf_code || 'IMF-9904',
          cotRequired: !!account.cot_required,
          taxRequired: !!account.tax_required,
          imfRequired: !!account.imf_required,
          kycStatus: account.kyc_status || 'VERIFIED',
          kycDocumentType: account.kyc_document_type || 'Passport',
          percentageChange: '+1.2%',
          status: (account.user_status === 'INACTIVE' || account.status === 'DORMANT' || account.status === 'FROZEN' || account.status === 'CLOSED') ? (account.user_status === 'INACTIVE' ? 'INACTIVE' : account.status) : account.status
        },
        audit: {
          lastLoginAt: req.user.lastLoginAt,
          lastLoginIp: req.user.lastLoginIp,
          currentIp: req.user.clientIp
        },
        metrics: {
          totalInflow: parseFloat(aggregates[0].total_inflow).toFixed(2),
          totalOutflow: parseFloat(aggregates[0].total_outflow).toFixed(2),
          transactionCount: aggregates[0].total_transactions,
          activeCards: active_cards,
          activeLoans: active_loans
        },
        recentTransactions: recentTransactions.map(t => ({
          id: t.id,
          reference: t.reference_number,
          type: t.transaction_type,
          channel: t.channel,
          amount: parseFloat(t.amount).toFixed(2),
          fee: parseFloat(t.fee).toFixed(2),
          currency: t.currency,
          counterpartyName: t.counterparty_name,
          counterpartyBank: t.counterparty_bank,
          counterpartyAccount: t.counterparty_account,
          narration: t.narration,
          status: t.status,
          postDate: t.post_date
        }))
      }
    });
  } catch (err) {
    console.error('Error in getSummary:', err);
    return res.status(500).json({
      success: false,
      status: 'SERVER_ERROR',
      message: 'Failed to load account summary.'
    });
  }
}

// Account Statement & Ledger History with Filterable Queries
async function getStatement(req, res) {
  try {
    const accountId = req.user.account.id;
    const { from, to, type, channel, search, limit = 50, offset = 0 } = req.query;

    let query = `SELECT id, reference_number, transaction_type, channel, amount, fee, currency, 
                        counterparty_name, counterparty_bank, counterparty_account, 
                        counterparty_swift_routing, narration, status, post_date
                 FROM transactions 
                 WHERE account_id = ?`;
    const params = [accountId];

    if (from) {
      query += ` AND post_date >= ?`;
      params.push(`${from} 00:00:00`);
    }

    if (to) {
      query += ` AND post_date <= ?`;
      params.push(`${to} 23:59:59`);
    }

    if (type && type !== 'ALL') {
      query += ` AND transaction_type = ?`;
      params.push(type.toUpperCase());
    }

    if (channel && channel !== 'ALL') {
      query += ` AND channel = ?`;
      params.push(channel.toUpperCase());
    }

    if (search) {
      query += ` AND (reference_number LIKE ? OR counterparty_name LIKE ? OR narration LIKE ?)`;
      const s = `%${search.trim()}%`;
      params.push(s, s, s);
    }

    query += ` ORDER BY post_date DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const [rows] = await pool.execute(query, params);

    // Count total filtered records
    let countQuery = `SELECT COUNT(id) as total FROM transactions WHERE account_id = ?`;
    const countParams = [accountId];
    if (from) { countQuery += ` AND post_date >= ?`; countParams.push(`${from} 00:00:00`); }
    if (to) { countQuery += ` AND post_date <= ?`; countParams.push(`${to} 23:59:59`); }
    if (type && type !== 'ALL') { countQuery += ` AND transaction_type = ?`; countParams.push(type.toUpperCase()); }
    if (search) {
      countQuery += ` AND (reference_number LIKE ? OR counterparty_name LIKE ? OR narration LIKE ?)`;
      const s = `%${search.trim()}%`;
      countParams.push(s, s, s);
    }

    const [[{ total }]] = await pool.execute(countQuery, countParams);

    return res.status(200).json({
      success: true,
      status: 'SUCCESS',
      data: {
        total,
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
        transactions: rows.map(t => ({
          id: t.id,
          reference: t.reference_number,
          type: t.transaction_type,
          channel: t.channel,
          amount: parseFloat(t.amount).toFixed(2),
          fee: parseFloat(t.fee).toFixed(2),
          currency: t.currency,
          counterpartyName: t.counterparty_name,
          counterpartyBank: t.counterparty_bank,
          counterpartyAccount: t.counterparty_account,
          swift: t.counterparty_swift_routing,
          narration: t.narration,
          status: t.status,
          postDate: t.post_date
        }))
      }
    });
  } catch (err) {
    console.error('Error in getStatement:', err);
    return res.status(500).json({
      success: false,
      status: 'SERVER_ERROR',
      message: 'Failed to retrieve transaction statements.'
    });
  }
}

module.exports = {
  getSummary,
  getStatement
};
