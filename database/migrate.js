const fs = require('fs');
const path = require('path');
const envPath = fs.existsSync(path.join(__dirname, '../.env'))
  ? path.join(__dirname, '../.env')
  : path.join(__dirname, '../backend/.env');
require('dotenv').config({ path: envPath });

const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

function generateAmortizationSchedule(principal, annualRate, months) {
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

async function migrateAndSeed() {
  console.log('🚀 [Migration] Connecting to MySQL server at', process.env.DB_HOST || 'localhost');
  
  const targetDb = process.env.DB_NAME || 'obsidian_trust_bank_db';
  const isRemoteHost = process.env.DB_SSL === 'true' || 
    (process.env.DB_HOST && !['localhost', '127.0.0.1', ''].includes(process.env.DB_HOST.trim()));

  if (!isRemoteHost) {
    try {
      const initConn = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT, 10) || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'celestial'
      });
      await initConn.query(`CREATE DATABASE IF NOT EXISTS \`${targetDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
      await initConn.end();
    } catch (e) {
      console.log('ℹ️ [Migration] Notice on DB creation check:', e.message);
    }
  }

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

  const rootConn = await mysql.createConnection(connConfig);

  try {
    const schemaPath = path.join(__dirname, 'schema.sql');
    console.log('📄 [Migration] Reading schema DDL from:', schemaPath);
    let schemaSql = fs.readFileSync(schemaPath, 'utf8');

    // Strip hardcoded CREATE DATABASE / USE to support any cloud database name (e.g., Aiven defaultdb)
    schemaSql = schemaSql.replace(/CREATE DATABASE IF NOT EXISTS[^;]+;/gi, '');
    schemaSql = schemaSql.replace(/USE `?[^;`]+`?;/gi, '');

    console.log('⚡ [Migration] Executing schema DDL in database:', targetDb);
    await rootConn.query(schemaSql);
    console.log('✅ [Migration] Schema and tables created successfully in', targetDb);

    console.log('🌱 [Seed] Generating password & PIN secure hashes...');
    const demoPasswordHash = await bcrypt.hash('Password123!', 10);
    const demoPinHash = await bcrypt.hash('1234', 10);
    const adminPasswordHash = await bcrypt.hash('AdminPassword123!', 10);
    const adminPinHash = await bcrypt.hash('9999', 10);

    const adminUserId = uuidv4();
    const adminAccountId = uuidv4();
    const userId1 = uuidv4();
    const accountId1 = uuidv4();
    const userId2 = uuidv4();
    const accountId2 = uuidv4();

    // 0. Insert Super Admin User
    console.log('🌱 [Seed] Inserting Master Admin: admin@otbplcfin.com');
    await rootConn.execute(
      `INSERT INTO users (
        id, role, first_name, last_name, email, password_hash, pin_hash, phone, 
        date_of_birth, gender, address, city, state, zip_code, kyc_photo_url, 
        status, last_login_at, last_login_ip
      ) VALUES (?, 'ADMIN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', NOW(), '127.0.0.1')`,
      [
        adminUserId,
        'Chief Systems',
        'Administrator',
        'admin@otbplcfin.com',
        adminPasswordHash,
        adminPinHash,
        '+1 800-555-0199',
        '1980-01-01',
        'Other',
        'Obsidian Headquarters Executive Tower',
        'London',
        'Greater London',
        'EC2N 1HQ',
        'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80'
      ]
    );

    // Admin primary account
    await rootConn.execute(
      `INSERT INTO accounts (
        id, user_id, account_number, account_type, currency, 
        available_balance, ledger_balance, status
      ) VALUES (?, ?, 'OTB-ADMIN-0001', 'Current Account', 'USD', 1000000.0000, 1000000.0000, 'ACTIVE')`,
      [adminAccountId, adminUserId]
    );

    // 1. Insert Demo Active Customer
    console.log('🌱 [Seed] Inserting demo customer: demo@otbplcfin.com');
    await rootConn.execute(
      `INSERT INTO users (
        id, role, first_name, last_name, email, password_hash, pin_hash, phone, 
        date_of_birth, gender, address, city, state, zip_code, kyc_photo_url, 
        status, last_login_at, last_login_ip
      ) VALUES (?, 'CUSTOMER', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', NOW(), ?)`,
      [
        userId1,
        'Alexander',
        'Vance',
        'demo@otbplcfin.com',
        demoPasswordHash,
        demoPinHash,
        '+44 20 7946 0912',
        '1988-06-14',
        'Male',
        '124 Canary Wharf Financial Tower, 14th Floor',
        'London',
        'Greater London',
        'E14 5AB',
        'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
        '127.0.0.1'
      ]
    );

    // 2. Insert Inactive User to verify Account Inactive flow
    console.log('🌱 [Seed] Inserting inactive user: inactive@otbplcfin.com');
    await rootConn.execute(
      `INSERT INTO users (
        id, role, first_name, last_name, email, password_hash, pin_hash, phone, 
        date_of_birth, gender, address, city, state, zip_code, kyc_photo_url, 
        status, last_login_at, last_login_ip
      ) VALUES (?, 'CUSTOMER', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INACTIVE', NULL, NULL)`,
      [
        userId2,
        'Edward',
        'Thorne',
        'inactive@otbplcfin.com',
        demoPasswordHash,
        demoPinHash,
        '+44 20 7946 0999',
        '1992-11-20',
        'Male',
        '88 Old Broad Street',
        'London',
        'Greater London',
        'EC2N 1HQ',
        null
      ]
    );

    // 3. Insert Accounts
    console.log('🌱 [Seed] Inserting customer bank accounts...');
    await rootConn.execute(
      `INSERT INTO accounts (
        id, user_id, account_number, account_type, currency, 
        available_balance, ledger_balance, status
      ) VALUES (?, ?, 'OTB-8839201948', 'Savings Account', 'USD', 147500.0000, 147500.0000, 'ACTIVE')`,
      [accountId1, userId1]
    );

    await rootConn.execute(
      `INSERT INTO accounts (
        id, user_id, account_number, account_type, currency, 
        available_balance, ledger_balance, status
      ) VALUES (?, ?, 'OTB-1092837465', 'Checking Account', 'USD', 0.0000, 0.0000, 'ACTIVE')`,
      [accountId2, userId2]
    );

    // 4. Insert Multi-Currency Wallets for Demo Customer
    console.log('🌱 [Seed] Inserting multi-currency wallets (USD, EUR, GBP, NGN)...');
    await rootConn.execute(
      `INSERT INTO wallets (id, user_id, account_id, currency, balance) VALUES
        (?, ?, ?, 'USD', 147500.0000),
        (?, ?, ?, 'EUR', 25000.0000),
        (?, ?, ?, 'GBP', 18400.0000),
        (?, ?, ?, 'NGN', 12500000.0000)`,
      [
        uuidv4(), userId1, accountId1,
        uuidv4(), userId1, accountId1,
        uuidv4(), userId1, accountId1,
        uuidv4(), userId1, accountId1
      ]
    );

    // 5. Insert Exchange Rates (USD base)
    console.log('🌱 [Seed] Inserting baseline currency exchange rates...');
    await rootConn.execute(
      `INSERT INTO exchange_rates (from_currency, to_currency, rate) VALUES
        ('USD', 'EUR', 0.920000),
        ('EUR', 'USD', 1.086957),
        ('USD', 'GBP', 0.780000),
        ('GBP', 'USD', 1.282051),
        ('USD', 'NGN', 1550.000000),
        ('NGN', 'USD', 0.000645),
        ('EUR', 'GBP', 0.847826),
        ('GBP', 'EUR', 1.179487),
        ('EUR', 'NGN', 1684.782600),
        ('NGN', 'EUR', 0.000593),
        ('GBP', 'NGN', 1987.179400),
        ('NGN', 'GBP', 0.000503)`
    );

    // 6. Insert Pending Deposit Simulations for Admin Queue Demo
    console.log('🌱 [Seed] Inserting pending deposits for Admin Queue...');
    await rootConn.execute(
      `INSERT INTO deposits (
        id, account_id, amount, currency, method, reference_number, 
        payer_name, payer_bank, check_number, proof_note, status
      ) VALUES 
      (?, ?, 45000.0000, 'USD', 'WIRE_DEPOSIT', 'DEP-2026-9901', 'Vanguard Capital Partners', 'JPMorgan Chase NY', NULL, 'Treasury institutional clearing wire awaiting compliance signoff.', 'PENDING_APPROVAL'),
      (?, ?, 12500.0000, 'USD', 'CHECK_DEPOSIT', 'DEP-2026-9902', 'Apex Global Logistics LLC', 'Wells Fargo Commercial', 'CHK-881920', 'Scanned check image verified. Pending executive approval.', 'PENDING_APPROVAL')`,
      [uuidv4(), accountId1, uuidv4(), accountId1]
    );

    // 7. Insert Credit Facilities: 1 Active Loan, 1 Pending Car Loan, 1 Pending Mortgage
    console.log('🌱 [Seed] Inserting Car Loan and Mortgage applications...');
    const carAmort = generateAmortizationSchedule(65000, 6.2, 48);
    const mortAmort = generateAmortizationSchedule(450000, 4.8, 240);

    // Active facility
    await rootConn.execute(
      `INSERT INTO loans (
        id, account_id, loan_reference, loan_title, loan_type, principal_amount, 
        interest_rate_apr, term_months, monthly_installment, remaining_balance, 
        monthly_income, status, disbursed_at, next_due_date
      ) VALUES (?, ?, 'LN-2026-0041', 'Commercial Revolving Credit', 'PERSONAL', 250000.0000, 4.50, 60, 4660.7800, 185400.0000, 45000.0000, 'ACTIVE', '2025-01-15', '2026-11-01')`,
      [uuidv4(), accountId1]
    );

    // Pending Car Loan
    await rootConn.execute(
      `INSERT INTO loans (
        id, account_id, loan_reference, loan_title, loan_type, principal_amount, 
        interest_rate_apr, term_months, monthly_installment, remaining_balance, 
        monthly_income, asset_details, amortization_schedule, status
      ) VALUES (?, ?, 'LN-CAR-2026-081', 'Executive Auto Financing - 2024 Mercedes-Benz E-Class', 'CAR_LOAN', 65000.0000, 6.20, 48, ?, 65000.0000, 14000.0000, ?, ?, 'PENDING_APPROVAL')`,
      [
        uuidv4(), 
        accountId1, 
        carAmort.monthlyInstallment, 
        JSON.stringify({
          make: 'Mercedes-Benz',
          model: 'E 350 4MATIC Sedan',
          year: 2024,
          vin: 'WDDZF4KB1RA123456',
          dealer: 'Mercedes-Benz of West London',
          vehicleValue: 72000.00,
          downPayment: 7000.00
        }),
        JSON.stringify(carAmort.schedule.slice(0, 12)) // First 12 months preview
      ]
    );

    // Pending Mortgage
    await rootConn.execute(
      `INSERT INTO loans (
        id, account_id, loan_reference, loan_title, loan_type, principal_amount, 
        interest_rate_apr, term_months, monthly_installment, remaining_balance, 
        monthly_income, asset_details, amortization_schedule, status
      ) VALUES (?, ?, 'LN-MORT-2026-102', 'Prime Residential Mortgage - Canary Wharf Penthouse', 'MORTGAGE', 450000.0000, 4.80, 240, ?, 450000.0000, 28000.0000, ?, ?, 'PENDING_APPROVAL')`,
      [
        uuidv4(), 
        accountId1, 
        mortAmort.monthlyInstallment, 
        JSON.stringify({
          propertyType: 'Penthouse Apartment',
          address: 'Apartment 42, Horizon Tower, Canary Wharf, London E14 9GE',
          propertyValue: 550000.00,
          downPayment: 100000.00,
          employment: 'Chief Executive Officer',
          employer: 'Vance Technology Holdings'
        }),
        JSON.stringify(mortAmort.schedule.slice(0, 24)) // First 24 months preview
      ]
    );

    // 8. Insert Cards for Demo User
    console.log('🌱 [Seed] Inserting debit & virtual credit cards...');
    await rootConn.execute(
      `INSERT INTO cards (
        id, account_id, card_number_masked, card_holder_name, 
        expiry_date, card_type, brand, status
      ) VALUES 
      (?, ?, '4111 •••• •••• 8839', 'Alexander Vance', '08/29', 'DEBIT', 'VISA', 'ACTIVE'),
      (?, ?, '5412 •••• •••• 1042', 'Alexander Vance', '11/28', 'VIRTUAL', 'MASTERCARD', 'ACTIVE')`,
      [uuidv4(), accountId1, uuidv4(), accountId1]
    );

    // 9. Insert Beneficiaries for Demo User
    console.log('🌱 [Seed] Inserting saved transfer beneficiaries...');
    await rootConn.execute(
      `INSERT INTO beneficiaries (
        id, account_id, name, bank_name, account_number, swift_routing, bank_address
      ) VALUES 
      (?, ?, 'Sarah Jenkins', 'Barclays Private Bank', '4491029381', 'BARCGB22', '1 Churchill Place, London E14 5HP'),
      (?, ?, 'Marcus Aurelius Sterling', 'HSBC Premier UK', '9920194822', 'HBUKGB41', '8 Canada Square, London E14 5HQ'),
      (?, ?, 'Geneva Global Trust S.A.', 'UBS Switzerland', 'CH9300240240123456789', 'UBSWCHZH', 'Bahnhofstrasse 45, 8001 Zurich')`,
      [uuidv4(), accountId1, uuidv4(), accountId1, uuidv4(), accountId1]
    );

    // 10. Insert Realistic Transaction Ledger
    console.log('🌱 [Seed] Inserting transaction ledger postings...');
    await rootConn.execute(
      `INSERT INTO transactions (
        id, account_id, reference_number, transaction_type, channel, 
        amount, fee, currency, counterparty_name, counterparty_bank, 
        counterparty_account, narration, status, post_date
      ) VALUES 
      (?, ?, 'TX-2026-9001', 'CREDIT', 'DEPOSIT', 50000.0000, 0.0000, 'USD', 'Obsidian Treasury Inward Clearing', 'Bank of England', 'BOE-00192', 'Quarterly Dividend Yield Allocation', 'COMPLETED', NOW() - INTERVAL 1 DAY),
      (?, ?, 'TX-2026-9002', 'DEBIT', 'INTERNATIONAL_WIRE', 12500.0000, 25.0000, 'USD', 'Geneva Global Trust S.A.', 'UBS Switzerland', 'CH9300240240123456789', 'Institutional Escrow Settlement', 'COMPLETED', NOW() - INTERVAL 3 DAY),
      (?, ?, 'TX-2026-9003', 'CREDIT', 'DEPOSIT', 110000.0000, 0.0000, 'USD', 'Apex Capital Liquidity Pool', 'Barclays Private Bank', 'BARC-99120', 'Series B Investment Tranche Proceeds', 'COMPLETED', NOW() - INTERVAL 7 DAY),
      (?, ?, 'TX-2026-9004', 'DEBIT', 'DOMESTIC_TRANSFER', 2450.0000, 5.0000, 'USD', 'City of London Corporate Tax Authority', 'National Westminster Bank', 'NWB-019283', 'Q3 Corporation Advance Duty', 'COMPLETED', NOW() - INTERVAL 12 DAY)`,
      [
        uuidv4(), accountId1,
        uuidv4(), accountId1,
        uuidv4(), accountId1,
        uuidv4(), accountId1
      ]
    );

    console.log('================================================================');
    console.log('🎉 [Migration & Seed] Completed successfully!');
    console.log('🔑 Master Admin User: admin@otbplcfin.com (Password: AdminPassword123! | PIN: 9999)');
    console.log('🔑 Active Customer:    demo@otbplcfin.com  (Password: Password123!      | PIN: 1234)');
    console.log('🔑 Inactive Customer:  inactive@otbplcfin.com (Password: Password123!)');
    console.log('================================================================');

  } catch (err) {
    console.error('❌ [Migration Error]:', err);
    process.exit(1);
  } finally {
    await rootConn.end();
  }
}

migrateAndSeed();
