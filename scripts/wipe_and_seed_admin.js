const pool = require('../src/config/db');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

async function cleanDatabase() {
  console.log('🧹 [Wipe] Starting full database cleanup on:', process.env.DB_HOST || 'localhost');

  const connection = await pool.getConnection();

  try {
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');

    // List of all data tables to truncate
    const tablesToWipe = [
      'transactions',
      'beneficiaries',
      'cards',
      'loans',
      'audit_logs',
      'contact_inquiries',
      'deposits',
      'wallets',
      'grants',
      'tax_refunds',
      'investments',
      'trading_trades',
      'trading_wallets',
      'academy_progress',
      'withdrawals',
      'support_messages',
      'support_tickets',
      'accounts',
      'users'
    ];

    for (const table of tablesToWipe) {
      try {
        await connection.query(`TRUNCATE TABLE \`${table}\``);
        console.log(`  🗑️  Cleared table: ${table}`);
      } catch (err) {
        // Table might not exist yet, delete instead
        try {
          await connection.query(`DELETE FROM \`${table}\``);
          console.log(`  🗑️  Deleted all rows from: ${table}`);
        } catch (e) {
          console.log(`  ℹ️  Skipped ${table} (${e.message})`);
        }
      }
    }

    await connection.query('SET FOREIGN_KEY_CHECKS = 1');

    console.log('\n👑 [Seed Admin] Creating clean Administrator account...');
    
    // Explicit production admin credentials
    const adminEmail = 'admin@vaultatlantic.com';
    const adminPassword = 'AdminPassword123!';
    const adminPin = '9999';

    const passwordHash = await bcrypt.hash(adminPassword, 10);
    const pinHash = await bcrypt.hash(adminPin, 10);

    const adminUserId = uuidv4();
    const adminAccountId = uuidv4();

    // Insert sole Admin user
    await connection.query(`
      INSERT INTO users (
        id, role, first_name, last_name, email, password_hash, pin_hash, phone,
        date_of_birth, gender, address, city, state, zip_code, status,
        last_login_at, last_login_ip
      ) VALUES (
        ?, 'ADMIN', 'Master', 'Administrator', ?, ?, ?, '+1 800-555-0199',
        '1980-01-01', 'Other', '12 Bridlesmith Walk, Nottingham', 'London', 'Greater London', 'EC2N 1HQ', 'ACTIVE',
        NOW(), '127.0.0.1'
      )
    `, [adminUserId, adminEmail, passwordHash, pinHash]);

    // Insert Admin primary current account
    await connection.query(`
      INSERT INTO accounts (
        id, user_id, account_number, account_type, currency,
        available_balance, ledger_balance, status
      ) VALUES (
        ?, ?, 'VA-ADMIN-0001', 'Current Account', 'USD',
        0.0000, 0.0000, 'ACTIVE'
      )
    `, [adminAccountId, adminUserId]);

    console.log('✅ Sole administrator inserted successfully!');
    console.log(`   - Email: ${adminEmail}`);
    console.log(`   - Password: ${adminPassword}`);
    console.log(`   - Security PIN: ${adminPin}`);
    console.log(`   - Account Number: VA-ADMIN-0001`);

    // Verify row counts across all tables
    console.log('\n📊 [Verification] Current Table Counts:');
    const [allTables] = await connection.query('SHOW TABLES');
    for (const row of allTables) {
      const tableName = Object.values(row)[0];
      const [[{ count }]] = await connection.query(`SELECT COUNT(*) as count FROM \`${tableName}\``);
      console.log(`   ${tableName.padEnd(25)} : ${count} row(s)`);
    }

    console.log('\n✨ Database is completely clean and ready for production!');
  } catch (error) {
    console.error('❌ Error during database cleanup:', error);
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

cleanDatabase()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
