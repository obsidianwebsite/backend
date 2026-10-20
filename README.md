# VaultProvenance Core Banking API Server

Enterprise-grade core banking backend REST API powering the **VaultProvenance** financial platform. Built with Node.js, Express, MySQL 8, and secure multi-tier JWT authentication.

---

## 🏗️ Architecture & Features

- **Multi-Factor Authentication**: Two-stage login with primary credentials and a 4-digit security PIN generating pre-auth and authenticated JWT tokens.
- **Role-Based Access Control**: Strict middleware isolation between `CUSTOMER` and `ADMIN` roles.
- **Core Banking Modules**:
  - **Account & Ledger Management**: Balance inquiry, real-time ledger accounting, statement generation with PDF export.
  - **Wire & Internal Transfers**: Domestic ACH, Fedwire, and SWIFT international wire processing with COT, IMF, and AML clearance protocols.
  - **Cards & Digital Wallets**: Virtual and physical card issuance, freeze/unfreeze controls, transaction limits, and multi-currency wallets.
  - **Credit & Lending**: Personal/business loan application, approval workflows, and automated amortization schedule calculation.
  - **Wealth & Fixed-Yield Investments**: High-yield portfolios, maturity calculations, and dividend distribution.
  - **Admin Command Center**: Real-time user management, KYC document review, transaction approval/reversal, and live system branding settings.
  - **AI Chatbot & Support**: Advanced assistant responding to banking queries, transaction assistance, and ticketing.
  - **Automated Notifications**: Transactional email notifications via Resend API (with built-in simulation fallback).

---

## 📁 Project Structure

```text
backend/
├── database/                   # Database schemas and migration scripts
│   ├── schema.sql              # Core DDL schema
│   ├── migrate.js              # Base database initializer and seeder
│   └── migrate_features.js     # Extended features migration
├── src/
│   ├── config/                 # Database connection pool & auto-migrations
│   ├── controllers/            # Request handlers (auth, admin, transfer, etc.)
│   ├── middleware/             # JWT verification, RBAC, error handlers
│   ├── routes/                 # Express API router definitions
│   ├── services/               # Chatbot logic, Resend email dispatchers
│   ├── app.js                  # Express application setup & middleware
│   └── server.js               # Entry point & HTTP server
├── test/                       # E2E and integration test suites
├── .env.example                # Safe environment configuration template
├── package.json
└── README.md
```

---

## ⚙️ Prerequisites

- **Node.js**: `v18.0.0` or higher
- **npm**: `v9.0.0` or higher
- **MySQL Server**: `8.0+` running locally or remotely

---

## 🚀 Quick Start

### 1. Clone & Install Dependencies

```bash
git clone <repository-url>
cd vaultprovenance-backend
npm install
```

### 2. Configure Environment Variables

Copy the example file:
```bash
cp .env.example .env
```

Update `.env` with your MySQL credentials and security keys:
```env
PORT=5000
NODE_ENV=development

# MySQL Database
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=obsidian_trust_bank_db

# Security Keys
JWT_SECRET=your_jwt_secret_key
JWT_PREAUTH_SECRET=your_preauth_secret_key
JWT_EXPIRES_IN=24h
JWT_PREAUTH_EXPIRES_IN=10m

# CORS Origin
CORS_ORIGIN=http://localhost:4200
FRONTEND_URL=http://localhost:4200

# Resend Email (Optional - runs in fallback mode if blank)
RESEND_API_KEY=
RESEND_FROM_EMAIL=VaultProvenance Bank <onboarding@resend.dev>
ADMIN_NOTIFICATION_EMAIL=admin@vaultprovenance.com
```

### 3. Initialize Database & Run Migrations

```bash
# Initialize database tables and seed baseline demo data
npm run migrate

# Run extended feature migrations (KYC, cards, loans, wallets)
npm run migrate:features
```

### 4. Start the API Server

```bash
# Development mode (with live reload)
npm run dev

# Production mode
npm start
```

The server will listen at `http://localhost:5000`.
- **Healthcheck Endpoint**: `GET http://localhost:5000/health`
- **Base API Endpoint**: `http://localhost:5000/api/v1`

---

## 🧪 Testing

Run integration tests against a running test database:

```bash
npm run test:integration
```

---

## 🛡️ Security Best Practices

- **Never commit `.env`**: Always keep actual production credentials, database passwords, and JWT secret keys out of version control.
- **Token Invalidation**: Use short expiration windows for pre-auth tokens (`10m`) and regular tokens (`24h`).
- **HTTPS**: In production environments, run behind a reverse proxy (e.g. Nginx, Cloudflare) with TLS 1.3 encryption enabled.
