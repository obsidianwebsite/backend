const app = require('./app');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { initSystemSettingsTable } = require('./config/migrate-settings');
initSystemSettingsTable().catch(err => console.error('Settings init error:', err.message));

const PORT = parseInt(process.env.PORT, 10) || 5000;

const server = app.listen(PORT, () => {
  console.log('================================================================');
  console.log(`🏦  Obsidian Trust Bank (OTB PLC) Core API Server Started`);
  console.log(`📡  Listening on: http://localhost:${PORT}`);
  console.log(`🛡️   Environment:  ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗  Healthcheck:  http://localhost:${PORT}/health`);
  console.log(`🎯  API V1 Base:  http://localhost:${PORT}/api/v1`);
  console.log('================================================================');
});

// Graceful Shutdown
process.on('SIGTERM', () => {
  console.log('🛑 [SIGTERM] Shutting down gracefully...');
  server.close(() => {
    console.log('Process terminated.');
  });
});

process.on('SIGINT', () => {
  console.log('🛑 [SIGINT] Shutting down gracefully...');
  server.close(() => {
    console.log('Process terminated.');
  });
});
