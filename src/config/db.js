const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'celestial',
  database: process.env.DB_NAME || 'obsidian_trust_bank_db',
  waitForConnections: true,
  connectionLimit: 15,
  queueLimit: 0,
  decimalNumbers: false // Ensure decimals are returned as strings to maintain precision
});

// Self-test connection pool
pool.getConnection()
  .then((conn) => {
    console.log('✅ [Database] MySQL Connection Pool initialized successfully (Database: ' + (process.env.DB_NAME || 'obsidian_trust_bank_db') + ')');
    conn.release();
  })
  .catch((err) => {
    console.error('❌ [Database Connection Error]:', err.message);
  });

module.exports = pool;
