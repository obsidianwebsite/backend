const fs = require('fs');
const path = require('path');
const envPath = fs.existsSync(path.join(__dirname, '../.env'))
  ? path.join(__dirname, '../.env')
  : path.join(__dirname, '../backend/.env');
require('dotenv').config({ path: envPath });

const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');

async function runFeatureMigration() {
  console.log('🚀 [Migration] Upgrading database with Explanatory Feature Book modules...');

  const targetDb = process.env.DB_NAME || 'obsidian_trust_bank_db';
  const isRemoteHost = process.env.DB_SSL === 'true' || 
    (process.env.DB_HOST && !['localhost', '127.0.0.1', ''].includes(process.env.DB_HOST.trim()));

  const connConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'celestial',
    database: targetDb,
    multipleStatements: true
  };

  if (isRemoteHost) {
    connConfig.ssl = { rejectUnauthorized: false };
  }

  const conn = await mysql.createConnection(connConfig);

  try {
    // 1. Add columns to `users` if they don't exist
    console.log('🔧 [Users] Ensuring KYC columns exist...');
    const [userCols] = await conn.query(`SHOW COLUMNS FROM users`);
    const userColNames = userCols.map(c => c.Field);

    if (!userColNames.includes('kyc_status')) {
      await conn.query(`ALTER TABLE users ADD COLUMN kyc_status ENUM('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED') NOT NULL DEFAULT 'VERIFIED' AFTER status`);
    }
    if (!userColNames.includes('kyc_document_type')) {
      await conn.query(`ALTER TABLE users ADD COLUMN kyc_document_type VARCHAR(50) DEFAULT 'Passport' AFTER kyc_status`);
    }
    if (!userColNames.includes('kyc_document_url')) {
      await conn.query(`ALTER TABLE users ADD COLUMN kyc_document_url VARCHAR(255) DEFAULT NULL AFTER kyc_document_type`);
    }

    // 2. Add columns to `accounts` if they don't exist
    console.log('🔧 [Accounts] Ensuring multi-balance & clearance code columns exist...');
    const [accCols] = await conn.query(`SHOW COLUMNS FROM accounts`);
    const accColNames = accCols.map(c => c.Field);

    if (!accColNames.includes('savings_balance')) {
      await conn.query(`ALTER TABLE accounts ADD COLUMN savings_balance DECIMAL(18, 4) NOT NULL DEFAULT 45200.0000 AFTER ledger_balance`);
    }
    if (!accColNames.includes('bonus_balance')) {
      await conn.query(`ALTER TABLE accounts ADD COLUMN bonus_balance DECIMAL(18, 4) NOT NULL DEFAULT 1500.0000 AFTER savings_balance`);
    }
    if (!accColNames.includes('investment_earnings')) {
      await conn.query(`ALTER TABLE accounts ADD COLUMN investment_earnings DECIMAL(18, 4) NOT NULL DEFAULT 12850.5000 AFTER bonus_balance`);
    }
    if (!accColNames.includes('cot_code')) {
      await conn.query(`ALTER TABLE accounts ADD COLUMN cot_code VARCHAR(32) DEFAULT 'COT-7749' AFTER status`);
    }
    if (!accColNames.includes('tax_code')) {
      await conn.query(`ALTER TABLE accounts ADD COLUMN tax_code VARCHAR(32) DEFAULT 'TAX-8821' AFTER cot_code`);
    }
    if (!accColNames.includes('imf_code')) {
      await conn.query(`ALTER TABLE accounts ADD COLUMN imf_code VARCHAR(32) DEFAULT 'IMF-9904' AFTER tax_code`);
    }

    // 3. Add columns to `cards` table if needed
    console.log('🔧 [Cards] Enhancing cards table with tiers & spending limits...');
    const [cardCols] = await conn.query(`SHOW COLUMNS FROM cards`);
    const cardColNames = cardCols.map(c => c.Field);

    if (!cardColNames.includes('tier')) {
      await conn.query(`ALTER TABLE cards ADD COLUMN tier ENUM('STANDARD', 'GOLD', 'PLATINUM', 'OBSIDIAN_BLACK') NOT NULL DEFAULT 'STANDARD' AFTER card_type`);
    }
    if (!cardColNames.includes('cvv')) {
      await conn.query(`ALTER TABLE cards ADD COLUMN cvv VARCHAR(4) DEFAULT '782' AFTER expiry_date`);
    }
    if (!cardColNames.includes('spending_limit')) {
      await conn.query(`ALTER TABLE cards ADD COLUMN spending_limit DECIMAL(18, 4) NOT NULL DEFAULT 15000.0000 AFTER status`);
    }
    // Update brand ENUM to include AMEX and DISCOVER if needed
    try {
      await conn.query(`ALTER TABLE cards MODIFY COLUMN brand ENUM('VISA', 'MASTERCARD', 'AMEX', 'DISCOVER') NOT NULL DEFAULT 'VISA'`);
    } catch (e) {
      console.log('Note on brand enum:', e.message);
    }

    // 4. Create `withdrawals` table
    console.log('📦 [Tables] Creating withdrawals table...');
    await conn.query(`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id VARCHAR(36) NOT NULL,
        account_id VARCHAR(36) NOT NULL,
        user_id VARCHAR(36) NOT NULL,
        reference_number VARCHAR(64) NOT NULL,
        amount DECIMAL(18, 4) NOT NULL,
        fee DECIMAL(18, 4) NOT NULL DEFAULT 0.0000,
        currency VARCHAR(10) NOT NULL DEFAULT 'USD',
        method ENUM('BANK_WIRE', 'ACH_TRANSFER', 'SWIFT_WIRE') NOT NULL DEFAULT 'BANK_WIRE',
        destination_details TEXT NOT NULL,
        status ENUM('PENDING_APPROVAL', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING_APPROVAL',
        admin_remarks TEXT DEFAULT NULL,
        reviewed_by VARCHAR(36) DEFAULT NULL,
        reviewed_at DATETIME DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_withdrawals_ref (reference_number),
        KEY idx_withdrawals_account (account_id),
        KEY idx_withdrawals_user (user_id),
        KEY idx_withdrawals_status (status),
        CONSTRAINT fk_withdrawals_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE,
        CONSTRAINT fk_withdrawals_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 5. Create `grants` table
    console.log('📦 [Tables] Creating grants table...');
    await conn.query(`
      CREATE TABLE IF NOT EXISTS grants (
        id VARCHAR(36) NOT NULL,
        user_id VARCHAR(36) NOT NULL,
        account_id VARCHAR(36) NOT NULL,
        reference_number VARCHAR(64) NOT NULL,
        programme_name VARCHAR(150) NOT NULL,
        category VARCHAR(50) NOT NULL,
        amount_requested DECIMAL(18, 4) NOT NULL,
        business_purpose TEXT NOT NULL,
        status ENUM('PROCESSING', 'APPROVED', 'REJECTED', 'DISBURSED') NOT NULL DEFAULT 'PROCESSING',
        admin_remarks TEXT DEFAULT NULL,
        disbursed_at DATETIME DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_grants_ref (reference_number),
        KEY idx_grants_user (user_id),
        KEY idx_grants_status (status),
        CONSTRAINT fk_grants_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT fk_grants_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 6. Create `tax_refunds` table
    console.log('📦 [Tables] Creating tax_refunds table...');
    await conn.query(`
      CREATE TABLE IF NOT EXISTS tax_refunds (
        id VARCHAR(36) NOT NULL,
        user_id VARCHAR(36) NOT NULL,
        account_id VARCHAR(36) NOT NULL,
        filing_id VARCHAR(64) NOT NULL,
        tax_year VARCHAR(10) NOT NULL,
        ssn_tin_masked VARCHAR(20) NOT NULL,
        expected_amount DECIMAL(18, 4) NOT NULL,
        filing_status ENUM('SINGLE', 'MARRIED_JOINT', 'HEAD_OF_HOUSEHOLD') NOT NULL DEFAULT 'SINGLE',
        refund_stage ENUM('RECEIVED', 'UNDER_REVIEW', 'APPROVED', 'DISBURSED') NOT NULL DEFAULT 'RECEIVED',
        notes TEXT DEFAULT NULL,
        disbursed_at DATETIME DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_tax_filing (filing_id),
        KEY idx_tax_user (user_id),
        KEY idx_tax_stage (refund_stage),
        CONSTRAINT fk_tax_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT fk_tax_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 7. Create `investment_plans` and `user_investments` tables
    console.log('📦 [Tables] Creating investment plans & subscriptions...');
    await conn.query(`
      CREATE TABLE IF NOT EXISTS investment_plans (
        id VARCHAR(36) NOT NULL,
        name VARCHAR(100) NOT NULL,
        category VARCHAR(50) NOT NULL,
        min_amount DECIMAL(18, 4) NOT NULL,
        max_amount DECIMAL(18, 4) NOT NULL,
        duration_days INT NOT NULL,
        roi_percent DECIMAL(6, 2) NOT NULL,
        description TEXT NOT NULL,
        risk_level ENUM('LOW', 'MEDIUM', 'HIGH') NOT NULL DEFAULT 'MEDIUM',
        status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS user_investments (
        id VARCHAR(36) NOT NULL,
        user_id VARCHAR(36) NOT NULL,
        account_id VARCHAR(36) NOT NULL,
        plan_id VARCHAR(36) NOT NULL,
        amount_invested DECIMAL(18, 4) NOT NULL,
        expected_roi DECIMAL(18, 4) NOT NULL,
        duration_days INT NOT NULL,
        status ENUM('ACTIVE', 'COMPLETED', 'LIQUIDATED') NOT NULL DEFAULT 'ACTIVE',
        start_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        end_date DATETIME NOT NULL,
        PRIMARY KEY (id),
        KEY idx_user_investments_user (user_id),
        CONSTRAINT fk_invest_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT fk_invest_plan FOREIGN KEY (plan_id) REFERENCES investment_plans (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 8. Create `trading_signals` and `copy_trading_masters`
    console.log('📦 [Tables] Creating trading signals & copy trading masters...');
    await conn.query(`
      CREATE TABLE IF NOT EXISTS trading_signals (
        id VARCHAR(36) NOT NULL,
        instrument VARCHAR(30) NOT NULL,
        type ENUM('FOREX', 'INDICES', 'COMMODITY') NOT NULL DEFAULT 'FOREX',
        direction ENUM('BUY', 'SELL') NOT NULL,
        entry_price DECIMAL(18, 5) NOT NULL,
        stop_loss DECIMAL(18, 5) NOT NULL,
        take_profit DECIMAL(18, 5) NOT NULL,
        timeframe VARCHAR(10) NOT NULL DEFAULT '1H',
        status ENUM('ACTIVE', 'TARGET_HIT', 'STOPPED_OUT', 'CLOSED') NOT NULL DEFAULT 'ACTIVE',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS copy_trading_masters (
        id VARCHAR(36) NOT NULL,
        trader_name VARCHAR(100) NOT NULL,
        strategy_name VARCHAR(100) NOT NULL,
        win_rate DECIMAL(5, 2) NOT NULL,
        monthly_return DECIMAL(5, 2) NOT NULL,
        copiers_count INT NOT NULL DEFAULT 0,
        profit_share_percent DECIMAL(5, 2) NOT NULL DEFAULT 15.00,
        risk_score INT NOT NULL DEFAULT 3,
        avatar_url VARCHAR(255) DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS user_copy_subscriptions (
        id VARCHAR(36) NOT NULL,
        user_id VARCHAR(36) NOT NULL,
        master_id VARCHAR(36) NOT NULL,
        allocated_amount DECIMAL(18, 4) NOT NULL,
        status ENUM('ACTIVE', 'PAUSED', 'STOPPED') NOT NULL DEFAULT 'ACTIVE',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_user_copy (user_id, master_id),
        CONSTRAINT fk_copy_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT fk_copy_master FOREIGN KEY (master_id) REFERENCES copy_trading_masters (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 9. Create `academy_courses`
    console.log('📦 [Tables] Creating academy courses table...');
    await conn.query(`
      CREATE TABLE IF NOT EXISTS academy_courses (
        id VARCHAR(36) NOT NULL,
        title VARCHAR(150) NOT NULL,
        category VARCHAR(50) NOT NULL,
        level ENUM('BEGINNER', 'INTERMEDIATE', 'ADVANCED') NOT NULL DEFAULT 'BEGINNER',
        duration_mins INT NOT NULL,
        modules_count INT NOT NULL DEFAULT 5,
        thumbnail_url VARCHAR(255) DEFAULT NULL,
        description TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 10. Seed Default Investment Plans if empty
    const [[{ planCount }]] = await conn.query(`SELECT COUNT(*) AS planCount FROM investment_plans`);
    if (planCount === 0) {
      console.log('🌱 [Seed] Populating institutional investment plans...');
      const plans = [
        [
          uuidv4(),
          'Treasury Alpha Yield',
          'Fixed Income',
          500.00,
          9999.00,
          14,
          8.50,
          'Short-term sovereign debt obligations with hedged risk and daily capital yield.',
          'LOW'
        ],
        [
          uuidv4(),
          'Obsidian Capital Growth',
          'Private Equity',
          2500.00,
          49999.00,
          30,
          19.20,
          'Diversified liquidity allocation across blue-chip liquidity pools and syndicated ventures.',
          'MEDIUM'
        ],
        [
          uuidv4(),
          'Quantum Multi-Strategy Yield',
          'Quantitative Arbitrage',
          10000.00,
          250000.00,
          60,
          38.50,
          'Algorithmic delta-neutral market-making and cross-venue latency arbitrage.',
          'HIGH'
        ],
        [
          uuidv4(),
          'Institutional Sovereign Vault',
          'Macro Hedge',
          50000.00,
          1000000.00,
          90,
          54.00,
          'High-net-worth tier tailored for accredited entities seeking compounded quarterly returns.',
          'LOW'
        ]
      ];

      for (const p of plans) {
        await conn.execute(
          `INSERT INTO investment_plans (id, name, category, min_amount, max_amount, duration_days, roi_percent, description, risk_level) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          p
        );
      }
    }

    // 11. Seed Copy Trading Masters if empty
    const [[{ masterCount }]] = await conn.query(`SELECT COUNT(*) AS masterCount FROM copy_trading_masters`);
    if (masterCount === 0) {
      console.log('🌱 [Seed] Populating MT4 Master Traders...');
      const masters = [
        [
          uuidv4(),
          'Marcus Vance, CMT',
          'Institutional FX Momentum',
          89.4,
          24.5,
          1420,
          15.0,
          2,
          'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80'
        ],
        [
          uuidv4(),
          'Elena Rostova',
          'Quant Delta-Neutral Macro',
          92.1,
          31.8,
          2180,
          18.0,
          3,
          'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=300&q=80'
        ],
        [
          uuidv4(),
          'Takeshi Hashimoto',
          'Tokyo Asian Session Scalping',
          86.7,
          19.4,
          985,
          12.0,
          2,
          'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&q=80'
        ],
        [
          uuidv4(),
          'David K. Sterling',
          'Cross-Asset Hedged Arbitrage',
          94.8,
          42.0,
          3640,
          20.0,
          4,
          'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&q=80'
        ]
      ];

      for (const m of masters) {
        await conn.execute(
          `INSERT INTO copy_trading_masters (id, trader_name, strategy_name, win_rate, monthly_return, copiers_count, profit_share_percent, risk_score, avatar_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          m
        );
      }
    }

    // 12. Seed Trading Signals if empty
    const [[{ signalCount }]] = await conn.query(`SELECT COUNT(*) AS signalCount FROM trading_signals`);
    if (signalCount === 0) {
      console.log('🌱 [Seed] Populating Live Forex & Index Signals...');
      const signals = [
        [uuidv4(), 'EUR/USD', 'FOREX', 'BUY', 1.08450, 1.07900, 1.09600, '4H', 'ACTIVE'],
        [uuidv4(), 'GBP/JPY', 'FOREX', 'BUY', 194.200, 193.100, 196.500, '1D', 'ACTIVE'],
        [uuidv4(), 'US30 (Wall St 30)', 'INDICES', 'BUY', 39500.00, 39300.00, 39950.00, '1H', 'ACTIVE'],
        [uuidv4(), 'XAU/USD (Gold)', 'COMMODITY', 'BUY', 2380.50, 2355.00, 2440.00, '4H', 'TARGET_HIT'],
        [uuidv4(), 'NAS100 (Tech Index)', 'INDICES', 'SELL', 18250.00, 18400.00, 17950.00, '15M', 'ACTIVE']
      ];

      for (const s of signals) {
        await conn.execute(
          `INSERT INTO trading_signals (id, instrument, type, direction, entry_price, stop_loss, take_profit, timeframe, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          s
        );
      }
    }

    // 13. Seed Academy Courses if empty
    const [[{ courseCount }]] = await conn.query(`SELECT COUNT(*) AS courseCount FROM academy_courses`);
    if (courseCount === 0) {
      console.log('🌱 [Seed] Populating Academy Courses...');
      const courses = [
        [
          uuidv4(),
          'Foundations of Modern Wealth Preservation',
          'Wealth Management',
          'BEGINNER',
          45,
          6,
          'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=500&q=80',
          'Learn the core structures of fiduciary asset management, high-yield vaults, and compound interest mechanics.'
        ],
        [
          uuidv4(),
          'Institutional Forex & Liquidity Protocols',
          'Trading & Markets',
          'INTERMEDIATE',
          60,
          8,
          'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=500&q=80',
          'Understanding order flow, institutional liquidity pools, interbank spreads, and algorithmic MT4 execution.'
        ],
        [
          uuidv4(),
          'Corporate Grant Writing & Federal Capital Procurement',
          'Grants & Capital',
          'INTERMEDIATE',
          50,
          5,
          'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=500&q=80',
          'A comprehensive step-by-step masterclass on qualifying, structuring, and applying for institutional and federal grants.'
        ],
        [
          uuidv4(),
          'Fixed Income Securities & Bond Yield Strategies',
          'Fixed Income',
          'ADVANCED',
          75,
          10,
          'https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?auto=format&fit=crop&w=500&q=80',
          'Master institutional sovereign debt, interest rate hedging, corporate paper, and portfolio maturity ladders.'
        ]
      ];

      for (const c of courses) {
        await conn.execute(
          `INSERT INTO academy_courses (id, title, category, level, duration_mins, modules_count, thumbnail_url, description)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          c
        );
      }
    }

    // 14. Ensure sample withdrawals, grants, and tax refunds exist for demonstration
    const [demoUsers] = await conn.query(`SELECT u.id, a.id as account_id FROM users u JOIN accounts a ON a.user_id = u.id WHERE u.email = 'david.chen@example.com' LIMIT 1`);
    if (demoUsers.length > 0) {
      const demoUser = demoUsers[0];

      // Sample Withdrawal
      const [existingW] = await conn.query(`SELECT COUNT(*) as cnt FROM withdrawals WHERE user_id = ?`, [demoUser.id]);
      if (existingW[0].cnt === 0) {
        console.log('🌱 [Seed] Creating sample pending withdrawal for David Chen...');
        await conn.execute(
          `INSERT INTO withdrawals (id, account_id, user_id, reference_number, amount, fee, currency, method, destination_details, status)
           VALUES (?, ?, ?, 'WTH-OTB-20261015-8812', 4500.0000, 15.0000, 'USD', 'BANK_WIRE', 'Citibank NA, Account #9928172918, Swift: CITIUS33', 'PENDING_APPROVAL')`,
          [uuidv4(), demoUser.account_id, demoUser.id]
        );
      }

      // Sample Grant Application
      const [existingG] = await conn.query(`SELECT COUNT(*) as cnt FROM grants WHERE user_id = ?`, [demoUser.id]);
      if (existingG[0].cnt === 0) {
        console.log('🌱 [Seed] Creating sample grant application for David Chen...');
        await conn.execute(
          `INSERT INTO grants (id, user_id, account_id, reference_number, programme_name, category, amount_requested, business_purpose, status)
           VALUES (?, ?, ?, 'GRT-OTB-20261015-4421', 'Clean Energy Tech Innovation Grant', 'Technology', 25000.0000, 'Expansion of solar battery storage facility and microgrid distribution infrastructure.', 'PROCESSING')`,
          [uuidv4(), demoUser.id, demoUser.account_id]
        );
      }

      // Sample Tax Refund Claim
      const [existingT] = await conn.query(`SELECT COUNT(*) as cnt FROM tax_refunds WHERE user_id = ?`, [demoUser.id]);
      if (existingT[0].cnt === 0) {
        console.log('🌱 [Seed] Creating sample IRS tax refund claim for David Chen...');
        await conn.execute(
          `INSERT INTO tax_refunds (id, user_id, account_id, filing_id, tax_year, ssn_tin_masked, expected_amount, filing_status, refund_stage, notes)
           VALUES (?, ?, ?, 'IRS-TX-2025-9921', '2025', '***-**-4892', 4850.0000, 'SINGLE', 'UNDER_REVIEW', 'Form 1040 processed. Direct deposit queued upon IRS clearance.')`,
          [uuidv4(), demoUser.id, demoUser.account_id]
        );
      }
    }

    console.log('✅ [Migration] Explanatory Feature Book database upgrade complete!');
  } catch (err) {
    console.error('❌ [Migration] Error during feature migration:', err);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

runFeatureMigration();
