const pool = require('./db');

async function initSupportTables() {
  console.log('🔄 Creating support tables if not existing...');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      ticket_number VARCHAR(30) UNIQUE NOT NULL,
      subject VARCHAR(255) NOT NULL,
      department VARCHAR(50) DEFAULT 'GENERAL_SUPPORT',
      priority VARCHAR(20) DEFAULT 'MEDIUM',
      status VARCHAR(20) DEFAULT 'OPEN',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user_id (user_id),
      INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_messages (
      id VARCHAR(36) PRIMARY KEY,
      ticket_id VARCHAR(36) NOT NULL,
      sender_id VARCHAR(36) NOT NULL,
      sender_role VARCHAR(20) NOT NULL,
      sender_name VARCHAR(150),
      message TEXT NOT NULL,
      attachments TEXT,
      is_read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ticket_id (ticket_id),
      INDEX idx_sender_id (sender_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  console.log('✅ Support tables verified/created successfully!');
  process.exit(0);
}

initSupportTables().catch(err => {
  console.error('❌ Migration Error:', err);
  process.exit(1);
});
