const pool = require('../src/config/db');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

async function createDavidConradAccount() {
  console.log('🏛️  [Account Setup] Initializing High-Net-Worth Account for David Conrad...');
  
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. Check if user already exists
    const email = 'davidconradbartek@gmail.com';
    const [existing] = await connection.query('SELECT id FROM users WHERE email = ?', [email]);
    
    let userId;
    if (existing.length > 0) {
      userId = existing[0].id;
      console.log(`ℹ️ User ${email} already exists (ID: ${userId}). Cleaning existing account & transactions...`);
      // Delete existing transactions and account for clean recreation
      const [oldAccounts] = await connection.query('SELECT id FROM accounts WHERE user_id = ?', [userId]);
      for (const acc of oldAccounts) {
        await connection.query('DELETE FROM transactions WHERE account_id = ?', [acc.id]);
        await connection.query('DELETE FROM cards WHERE account_id = ?', [acc.id]);
        await connection.query('DELETE FROM beneficiaries WHERE account_id = ?', [acc.id]);
        await connection.query('DELETE FROM accounts WHERE id = ?', [acc.id]);
      }
      await connection.query('DELETE FROM users WHERE id = ?', [userId]);
    }

    userId = uuidv4();
    const accountId = uuidv4();

    // Credentials
    const passwordPlain = 'Password123!';
    const pinPlain = '1955'; // Matching birth year 1955

    const passwordHash = await bcrypt.hash(passwordPlain, 10);
    const pinHash = await bcrypt.hash(pinPlain, 10);

    // 2. Insert User: David Conrad
    await connection.query(`
      INSERT INTO users (
        id, role, first_name, last_name, email, password_hash, pin_hash, phone,
        date_of_birth, gender, address, city, state, zip_code, kyc_photo_url,
        status, kyc_status, kyc_document_type, last_login_at, last_login_ip, created_at
      ) VALUES (
        ?, 'CUSTOMER', 'David', 'Conrad', ?, ?, ?, '+1 (310) 849-2041',
        '1955-10-10', 'Male', '9454 Wilshire Boulevard, Suite 800', 'Los Angeles', 'California', '90212',
        'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80',
        'ACTIVE', 'VERIFIED', 'United States Passport', NOW(), '127.0.0.1', '2025-01-01 08:00:00'
      )
    `, [userId, email, passwordHash, pinHash]);
    console.log('✅ User record created: David Conrad');

    // 3. Insert Account: $599,000,000.00
    const accountNumber = 'VP-88291045';
    const balance = 599000000.0000;

    await connection.query(`
      INSERT INTO accounts (
        id, user_id, account_number, account_type, currency,
        available_balance, ledger_balance, savings_balance, bonus_balance, investment_earnings,
        status, cot_code, tax_code, imf_code, created_at
      ) VALUES (
        ?, ?, ?, 'Current Account', 'USD',
        ?, ?, 25000000.0000, 0.0000, 14250000.0000,
        'ACTIVE', 'COT-8812', 'TAX-9041', 'IMF-7720', '2025-01-01 09:00:00'
      )
    `, [accountId, userId, accountNumber, balance, balance]);
    console.log(`✅ Account record created: ${accountNumber} with Balance: $${balance.toLocaleString()}`);

    // 4. Insert Black Metal Debit Card
    const cardId = uuidv4();
    await connection.query(`
      INSERT INTO cards (
        id, account_id, card_number_masked, card_holder_name, expiry_date, cvv,
        card_type, tier, brand, status, spending_limit, created_at
      ) VALUES (
        ?, ?, '4532 •••• •••• 9104', 'DAVID CONRAD', '10/29', '882',
        'DEBIT', 'OBSIDIAN_BLACK', 'VISA', 'ACTIVE', 1000000.0000, '2025-01-05 10:00:00'
      )
    `, [cardId, accountId]);
    console.log('✅ Obsidian Black debit card issued: 4532 •••• •••• 9104');

    // 5. Insert Institutional Beneficiaries
    const beneficiaries = [
      { name: 'Blackstone Real Estate Partners', bank: 'JPMorgan Chase Bank, N.A.', account: '8829019284', swift: 'CHASUS33', address: '345 Park Ave, New York, NY 10154' },
      { name: 'Morgan Stanley Wealth Management', bank: 'Morgan Stanley Private Bank', account: '4491029481', swift: 'MSCOUS33', address: '1585 Broadway, New York, NY 10036' },
      { name: 'Latham & Watkins LLP Escrow', bank: 'Citibank N.A.', account: '1192830192', swift: 'CITIUS33', address: '355 S Grand Ave, Los Angeles, CA 90071' }
    ];

    for (const b of beneficiaries) {
      await connection.query(`
        INSERT INTO beneficiaries (id, account_id, name, bank_name, account_number, swift_routing, bank_address, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, '2025-01-10 11:00:00')
      `, [uuidv4(), accountId, b.name, b.bank, b.account, b.swift, b.address]);
    }
    console.log('✅ Institutional wire beneficiaries linked');

    // 6. Insert 20 Transactions from January 2025 till October 2025
    // Ending balance = exactly $599,000,000.00
    const transactions = [
      {
        date: '2025-01-15 10:14:22',
        type: 'CREDIT',
        channel: 'INTERNATIONAL_WIRE',
        amount: 250000000.0000,
        counterparty: 'JPMorgan Chase N.A. (Global Custody)',
        bank: 'JPMorgan Chase Bank, N.A.',
        account: 'US89CHAS320914881029',
        swift: 'CHASUS33',
        narration: 'Capital Settlement - Liquidity Placement & Structured Equity Realization',
        ref: 'VPW-20250115-0814'
      },
      {
        date: '2025-01-28 14:35:10',
        type: 'DEBIT',
        channel: 'DOMESTIC_TRANSFER',
        amount: 15000000.0000,
        counterparty: 'Blackstone Real Estate Partners IX',
        bank: 'Bank of New York Mellon',
        account: 'US12BKTR882910488192',
        swift: 'IRVTUS3N',
        narration: 'Capital Call Contribution - Commercial Assets Fund Tranche I',
        ref: 'VPW-20250128-4491'
      },
      {
        date: '2025-02-12 11:20:04',
        type: 'CREDIT',
        channel: 'INTERNATIONAL_WIRE',
        amount: 85000000.0000,
        counterparty: 'UBS Switzerland AG (Zurich Private Banking)',
        bank: 'UBS Switzerland AG',
        account: 'CH930023488210928301',
        swift: 'UBSWCHZH',
        narration: 'Treasury Inbound Remittance - Global Sovereign Bond Divestment Proceeds',
        ref: 'VPW-20250212-7729'
      },
      {
        date: '2025-02-24 16:45:18',
        type: 'DEBIT',
        channel: 'INTERNATIONAL_WIRE',
        amount: 8500000.0000,
        counterparty: 'Christie’s International Escrow Ltd',
        bank: 'Barclays Bank UK PLC',
        account: 'GB82BARC200000889210',
        swift: 'BARCGB22',
        narration: 'Private Acquisition Escrow Settlement - Historic Art & Provenance Lot #8821',
        ref: 'VPW-20250224-1182'
      },
      {
        date: '2025-03-10 09:50:33',
        type: 'CREDIT',
        channel: 'INTERNATIONAL_WIRE',
        amount: 120000000.0000,
        counterparty: 'Morgan Stanley Institutional Treasury',
        bank: 'Morgan Stanley Bank, N.A.',
        account: 'US77MSCO449102847719',
        swift: 'MSCOUS33',
        narration: 'Institutional M&A Liquidity Proceeds - Tech Venture Secondary Share Realization',
        ref: 'VPW-20250310-9904'
      },
      {
        date: '2025-03-25 15:12:40',
        type: 'DEBIT',
        channel: 'DOMESTIC_TRANSFER',
        amount: 22000000.0000,
        counterparty: 'Goldman Sachs Asset Management Trust',
        bank: 'Goldman Sachs Bank USA',
        account: 'US44GSBK992810488210',
        swift: 'GSBKUS33',
        narration: 'Private Equity Capital Facility - Series G Multi-Stage Institutional Allocation',
        ref: 'VPW-20250325-3381'
      },
      {
        date: '2025-04-14 11:05:19',
        type: 'CREDIT',
        channel: 'INTERNATIONAL_WIRE',
        amount: 45000000.0000,
        counterparty: 'HSBC Bank plc London (Global Markets)',
        bank: 'HSBC Bank plc',
        account: 'GB44MIDL400000998124',
        swift: 'HBUKGB41',
        narration: 'Semi-Annual High-Yield Fixed Income Yield Distribution & Interest Settlement',
        ref: 'VPW-20250414-6612'
      },
      {
        date: '2025-04-28 13:40:55',
        type: 'DEBIT',
        channel: 'DOMESTIC_TRANSFER',
        amount: 14200000.0000,
        counterparty: 'First American Title Insurance Company',
        bank: 'Wells Fargo Bank, N.A.',
        account: 'US99WFBI118290488192',
        swift: 'PNBPUS33',
        narration: 'Commercial Real Estate Closing Escrow - Los Angeles Prime Commercial Acquisition',
        ref: 'VPW-20250428-2204'
      },
      {
        date: '2025-05-16 10:30:12',
        type: 'CREDIT',
        channel: 'INTERNATIONAL_WIRE',
        amount: 95000000.0000,
        counterparty: 'UBS Wealth Management Geneva',
        bank: 'UBS Switzerland AG',
        account: 'CH480023499182049182',
        swift: 'UBSWCHGG',
        narration: 'Direct Investment Liquidation - Structured Note Redemption & Principal Return',
        ref: 'VPW-20250516-8831'
      },
      {
        date: '2025-05-29 14:18:44',
        type: 'DEBIT',
        channel: 'DOMESTIC_TRANSFER',
        amount: 11800000.0000,
        counterparty: 'Sequoia Capital Global Growth Fund',
        bank: 'Silicon Valley Bank / First Citizens',
        account: 'US33FCNB882910488102',
        swift: 'SIVBUS6S',
        narration: 'Venture Capital Tranche Disbursement - Global Innovation Fund IV Allocation',
        ref: 'VPW-20250529-5509'
      },
      {
        date: '2025-06-18 11:45:20',
        type: 'CREDIT',
        channel: 'INTERNATIONAL_WIRE',
        amount: 60000000.0000,
        counterparty: 'Barclays Private Bank Jersey',
        bank: 'Barclays Bank PLC',
        account: 'GB33BARC200000772819',
        swift: 'BARCJE22',
        narration: 'Institutional Dividend Credit - Global Energy & Infrastructure Asset Holdings',
        ref: 'VPW-20250618-4490'
      },
      {
        date: '2025-06-30 15:22:31',
        type: 'DEBIT',
        channel: 'INTERNATIONAL_WIRE',
        amount: 18500000.0000,
        counterparty: 'Lombard Odier & Cie Private Bankers',
        bank: 'Banque Lombard Odier & Cie SA',
        account: 'CH220876543210987654',
        swift: 'LOCICHGG',
        narration: 'Cross-Border Wealth Reallocation - European Discretionary Mandate Fund',
        ref: 'VPW-20250630-9921'
      },
      {
        date: '2025-07-15 09:30:15',
        type: 'CREDIT',
        channel: 'INTERNATIONAL_WIRE',
        amount: 72000000.0000,
        counterparty: 'Citigroup Global Markets Inc',
        bank: 'Citibank, N.A.',
        account: 'US55CITI339182049182',
        swift: 'CITIUS33',
        narration: 'Syndicated Debt Facility Return of Principal & Accrued Floating Rate Coupon',
        ref: 'VPW-20250715-1104'
      },
      {
        date: '2025-07-28 16:10:48',
        type: 'DEBIT',
        channel: 'DOMESTIC_TRANSFER',
        amount: 25000000.0000,
        counterparty: 'Carlyle Group Global Partners',
        bank: 'JPMorgan Chase Bank, N.A.',
        account: 'US88CHAS772910488192',
        swift: 'CHASUS33',
        narration: 'Private Capital Partnership Call - Global Infrastructure & Logistics Fund II',
        ref: 'VPW-20250728-7738'
      },
      {
        date: '2025-08-12 10:15:33',
        type: 'CREDIT',
        channel: 'INTERNATIONAL_WIRE',
        amount: 40000000.0000,
        counterparty: 'Deutsche Bank Wealth Management Frankfurt',
        bank: 'Deutsche Bank AG',
        account: 'DE895007001009876543',
        swift: 'DEUTDEDD',
        narration: 'Treasury Inward Remittance - European Municipal Bond Portfolio Semi-Annual Yield',
        ref: 'VPW-20250812-3329'
      },
      {
        date: '2025-08-27 14:40:22',
        type: 'DEBIT',
        channel: 'DOMESTIC_TRANSFER',
        amount: 34500000.0000,
        counterparty: 'Latham & Watkins LLP Client Trust Account',
        bank: 'Citibank, N.A.',
        account: 'US11CITI992810488291',
        swift: 'CITIUS33',
        narration: 'Institutional Retainer & Corporate Cross-Border M&A Acquisition Escrow',
        ref: 'VPW-20250827-8812'
      },
      {
        date: '2025-09-10 11:25:40',
        type: 'CREDIT',
        channel: 'INTERNATIONAL_WIRE',
        amount: 55000000.0000,
        counterparty: 'Standard Chartered Private Bank Singapore',
        bank: 'Standard Chartered Bank',
        account: 'SG44SCBL882910488210',
        swift: 'SCBLSG22',
        narration: 'Asia-Pacific Prime Logistics Fund Dividend Distribution & Partial Return of Equity',
        ref: 'VPW-20250910-4419'
      },
      {
        date: '2025-09-24 15:50:11',
        type: 'DEBIT',
        channel: 'INTERNATIONAL_WIRE',
        amount: 48500000.0000,
        counterparty: 'Julius Baer & Co Ltd Geneva',
        bank: 'Bank Julius Baer & Co. Ltd.',
        account: 'CH660882109283746501',
        swift: 'BAERCHGG',
        narration: 'Diversified Asset Allocation Rebalance - Swiss Sovereign Treasury Certificates',
        ref: 'VPW-20250924-6628'
      },
      {
        date: '2025-10-08 10:35:05',
        type: 'DEBIT',
        channel: 'DOMESTIC_TRANSFER',
        amount: 35000000.0000,
        counterparty: 'Apollo Global Management LP',
        bank: 'Bank of America, N.A.',
        account: 'US77BOFA882910488192',
        swift: 'BOFAUS3N',
        narration: 'Private Credit Direct Lending Syndicate Drawdown - Senior Secured Facility',
        ref: 'VPW-20251008-1190'
      },
      {
        date: '2025-10-22 14:15:30',
        type: 'CREDIT',
        channel: 'INTERNATIONAL_WIRE',
        amount: 10000000.0000,
        counterparty: 'Bank of America Private Bank NYC',
        bank: 'Bank of America, N.A.',
        account: 'US22BOFA449102847729',
        swift: 'BOFAUS3N',
        narration: 'Quarterly Institutional Treasury Liquidity Sweep & Discretionary Portfolio Yield',
        ref: 'VPW-20251022-5501'
      }
    ];

    let netCalculated = 0;
    for (const tx of transactions) {
      if (tx.type === 'CREDIT') netCalculated += tx.amount;
      else netCalculated -= tx.amount;

      await connection.query(`
        INSERT INTO transactions (
          id, account_id, reference_number, transaction_type, channel,
          amount, fee, currency, counterparty_name, counterparty_bank,
          counterparty_account, counterparty_swift_routing, narration,
          status, post_date, created_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, 0.0000, 'USD', ?, ?,
          ?, ?, ?,
          'COMPLETED', ?, ?
        )
      `, [
        uuidv4(), accountId, tx.ref, tx.type, tx.channel,
        tx.amount, tx.counterparty, tx.bank,
        tx.account, tx.swift, tx.narration,
        tx.date, tx.date
      ]);
    }

    console.log(`✅ ${transactions.length} historical transactions inserted from January till October 2025!`);
    console.log(`   Calculated Cumulative Ledger Balance: $${netCalculated.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);

    await connection.commit();
    console.log('\n🎉 [Success] David Conrad account setup is complete and fully committed!');

    console.log('\n======================================================');
    console.log('👤 CLIENT CREDENTIALS & DETAILS:');
    console.log(`   Name:            David Conrad`);
    console.log(`   Email:           ${email}`);
    console.log(`   Password:        ${passwordPlain}`);
    console.log(`   Security PIN:    ${pinPlain}`);
    console.log(`   Account Number:  ${accountNumber}`);
    console.log(`   Account Type:    Current Account`);
    console.log(`   Available Funds: $${balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`   Date of Birth:   10/10/1955`);
    console.log(`   Address:         9454 Wilshire Boulevard, Suite 800, Los Angeles, California, 90212, USA`);
    console.log(`   Debit Card:      4532 •••• •••• 9104 (Obsidian Black)`);
    console.log(`   Transactions:    20 records spanning Jan 15, 2025 - Oct 22, 2025`);
    console.log('======================================================\n');

  } catch (error) {
    await connection.rollback();
    console.error('❌ Error during setup:', error);
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

createDavidConradAccount()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
