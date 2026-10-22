const pool = require('./db');

async function initSystemSettingsTable() {
  console.log('🔄 Initializing system_settings table if not existing...');
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_settings (
      id VARCHAR(50) PRIMARY KEY DEFAULT 'main_settings',
      site_name VARCHAR(255) NOT NULL DEFAULT 'Obsidian Trust Bancorp Plc',
      site_tagline VARCHAR(255) NOT NULL DEFAULT 'Commercial Banking & Institutional Treasury',
      site_logo_url TEXT,
      site_favicon_url TEXT,
      contact_email VARCHAR(255) NOT NULL DEFAULT 'support@obsidiantrustbancorp.com',
      admin_notification_email VARCHAR(255) NOT NULL DEFAULT 'admin@obsidiantrustbancorp.com',
      phone_number VARCHAR(100) NOT NULL DEFAULT '+44 20 7946 0912',
      address TEXT NOT NULL,
      swift_code VARCHAR(50) NOT NULL DEFAULT 'OTBCGB2L',
      routing_number VARCHAR(50) NOT NULL DEFAULT '026009593',
      currency_code VARCHAR(10) NOT NULL DEFAULT 'USD',
      currency_symbol VARCHAR(10) NOT NULL DEFAULT '$',
      about_summary TEXT,
      copyright_text VARCHAR(255) NOT NULL DEFAULT '© 2026 Obsidian Trust Bancorp Plc. Authorized & Regulated Commercial Banking Institution.',
      support_hours VARCHAR(100) NOT NULL DEFAULT '24/7 Global Treasury Support Desk',
      is_setup_completed BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    INSERT INTO system_settings (
      id,
      site_name,
      site_tagline,
      site_logo_url,
      site_favicon_url,
      contact_email,
      admin_notification_email,
      phone_number,
      address,
      swift_code,
      routing_number,
      currency_code,
      currency_symbol,
      about_summary,
      copyright_text,
      support_hours,
      is_setup_completed
    ) VALUES (
      'main_settings',
      'Obsidian Trust Bancorp Plc',
      'Commercial Banking & Institutional Treasury',
      '',
      '',
      'support@obsidiantrustbancorp.com',
      'admin@obsidiantrustbancorp.com',
      '+44 20 7946 0912',
      '12 Bridlesmith Walk, Nottingham, NG1 2HB, United Kingdom',
      'OTBCGB2L',
      '026009593',
      'USD',
      '$',
      'Obsidian Trust Bancorp Plc is an authorized and regulated British-Atlantic commercial banking and institutional treasury corporation providing private wealth management, corporate escrow, multi-currency clearing, and structured capital facilities.',
      '© 2026 Obsidian Trust Bancorp Plc. Authorized & Regulated Commercial Banking Institution.',
      '24/7 Global Treasury Support Desk',
      TRUE
    ) ON DUPLICATE KEY UPDATE id = id;
  `);

  console.log('✅ system_settings table initialized and seeded successfully!');
  return true;
}

module.exports = { initSystemSettingsTable };

if (require.main === module) {
  initSystemSettingsTable()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Migration Error:', err);
      process.exit(1);
    });
}
