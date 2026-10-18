const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const apiRoutes = require('./routes/api');
const { errorHandler, notFoundHandler } = require('./middleware/error.middleware');

const app = express();

// Middleware Stack
app.use(cors({
  origin: '*', // Allow all origins for dev / Angular on 4200
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-PreAuth-Token']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// System Health Check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ONLINE',
    service: 'Obsidian Trust Bank (OTB PLC) Core API Engine',
    timestamp: new Date().toISOString()
  });
});

// Mount V1 API Routes
app.use('/api/v1', apiRoutes);

// Error Handling Stack
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
