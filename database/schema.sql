-- ==============================================================================
-- Obsidian Trust Bank (OTB PLC) - Enterprise Financial Database Schema
-- Compatible with MySQL 8.0+
-- Invariant: DECIMAL(18, 4) monetary precision, Strict Foreign Keys, UTF8MB4
-- ==============================================================================

CREATE DATABASE IF NOT EXISTS `obsidian_trust_bank_db` 
  CHARACTER SET utf8mb4 
  COLLATE utf8mb4_unicode_ci;

USE `obsidian_trust_bank_db`;

-- Drop tables in reverse foreign key order if re-initializing
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `exchange_rates`;
DROP TABLE IF EXISTS `wallets`;
DROP TABLE IF EXISTS `deposits`;
DROP TABLE IF EXISTS `contact_inquiries`;
DROP TABLE IF EXISTS `audit_logs`;
DROP TABLE IF EXISTS `loans`;
DROP TABLE IF EXISTS `cards`;
DROP TABLE IF EXISTS `beneficiaries`;
DROP TABLE IF EXISTS `transactions`;
DROP TABLE IF EXISTS `accounts`;
DROP TABLE IF EXISTS `users`;
SET FOREIGN_KEY_CHECKS = 1;

-- ------------------------------------------------------------------------------
-- 1. USERS TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE `users` (
  `id` VARCHAR(36) NOT NULL,
  `role` ENUM('ADMIN', 'CUSTOMER') NOT NULL DEFAULT 'CUSTOMER',
  `first_name` VARCHAR(100) NOT NULL,
  `last_name` VARCHAR(100) NOT NULL,
  `email` VARCHAR(150) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `pin_hash` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(30) NOT NULL,
  `date_of_birth` DATE NOT NULL,
  `gender` ENUM('Male', 'Female', 'Other') NOT NULL,
  `address` TEXT NOT NULL,
  `city` VARCHAR(100) NOT NULL,
  `state` VARCHAR(100) NOT NULL,
  `zip_code` VARCHAR(30) NOT NULL,
  `kyc_photo_url` VARCHAR(255) DEFAULT NULL,
  `status` ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
  `last_login_at` DATETIME DEFAULT NULL,
  `last_login_ip` VARCHAR(45) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_users_email` (`email`),
  KEY `idx_users_status` (`status`),
  KEY `idx_users_role` (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------------------
-- 2. ACCOUNTS TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE `accounts` (
  `id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `account_number` VARCHAR(20) NOT NULL,
  `account_type` ENUM(
    'Savings Account', 
    'Current Account', 
    'Checking Account', 
    'Fixed Deposit Account', 
    'Off Shore Account'
  ) NOT NULL DEFAULT 'Savings Account',
  `currency` VARCHAR(3) NOT NULL DEFAULT 'USD',
  `available_balance` DECIMAL(18, 4) NOT NULL DEFAULT 0.0000,
  `ledger_balance` DECIMAL(18, 4) NOT NULL DEFAULT 0.0000,
  `status` ENUM('ACTIVE', 'DORMANT', 'FROZEN', 'CLOSED') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_accounts_number` (`account_number`),
  KEY `idx_accounts_user` (`user_id`),
  CONSTRAINT `fk_accounts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------------------
-- 3. TRANSACTIONS TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE `transactions` (
  `id` VARCHAR(36) NOT NULL,
  `account_id` VARCHAR(36) NOT NULL,
  `reference_number` VARCHAR(64) NOT NULL,
  `transaction_type` ENUM('CREDIT', 'DEBIT') NOT NULL,
  `channel` ENUM(
    'DOMESTIC_TRANSFER', 
    'LOCAL_TRANSFER', 
    'INTERNATIONAL_WIRE', 
    'DEPOSIT', 
    'LOAN_DISBURSEMENT', 
    'FEE',
    'WALLET_EXCHANGE'
  ) NOT NULL,
  `amount` DECIMAL(18, 4) NOT NULL,
  `fee` DECIMAL(18, 4) NOT NULL DEFAULT 0.0000,
  `currency` VARCHAR(3) NOT NULL DEFAULT 'USD',
  `counterparty_name` VARCHAR(100) NOT NULL,
  `counterparty_bank` VARCHAR(100) NOT NULL,
  `counterparty_account` VARCHAR(50) NOT NULL,
  `counterparty_swift_routing` VARCHAR(20) DEFAULT NULL,
  `narration` TEXT DEFAULT NULL,
  `status` ENUM('COMPLETED', 'PENDING', 'PENDING_APPROVAL', 'FAILED', 'REVERSED', 'REJECTED') NOT NULL DEFAULT 'COMPLETED',
  `post_date` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_transactions_ref` (`reference_number`),
  KEY `idx_transactions_account_post` (`account_id`, `post_date`),
  KEY `idx_transactions_status` (`status`),
  CONSTRAINT `fk_transactions_account` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------------------
-- 4. DEPOSITS QUEUE TABLE (ADMIN HUMAN-IN-THE-LOOP INTERCEPTION)
-- ------------------------------------------------------------------------------
CREATE TABLE `deposits` (
  `id` VARCHAR(36) NOT NULL,
  `account_id` VARCHAR(36) NOT NULL,
  `amount` DECIMAL(18, 4) NOT NULL,
  `currency` VARCHAR(3) NOT NULL DEFAULT 'USD',
  `method` ENUM('BANK_TRANSFER', 'CHECK_DEPOSIT', 'WIRE_DEPOSIT') NOT NULL DEFAULT 'BANK_TRANSFER',
  `reference_number` VARCHAR(64) NOT NULL,
  `payer_name` VARCHAR(100) DEFAULT NULL,
  `payer_bank` VARCHAR(100) DEFAULT NULL,
  `check_number` VARCHAR(64) DEFAULT NULL,
  `proof_note` TEXT DEFAULT NULL,
  `status` ENUM('PENDING_APPROVAL', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING_APPROVAL',
  `admin_remarks` TEXT DEFAULT NULL,
  `reviewed_by` VARCHAR(36) DEFAULT NULL,
  `reviewed_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_deposits_ref` (`reference_number`),
  KEY `idx_deposits_account` (`account_id`),
  KEY `idx_deposits_status` (`status`),
  CONSTRAINT `fk_deposits_account` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------------------
-- 5. BENEFICIARIES TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE `beneficiaries` (
  `id` VARCHAR(36) NOT NULL,
  `account_id` VARCHAR(36) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `bank_name` VARCHAR(100) NOT NULL,
  `account_number` VARCHAR(50) NOT NULL,
  `swift_routing` VARCHAR(20) DEFAULT NULL,
  `bank_address` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_beneficiaries_account` (`account_id`),
  CONSTRAINT `fk_beneficiaries_account` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------------------
-- 6. CARDS TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE `cards` (
  `id` VARCHAR(36) NOT NULL,
  `account_id` VARCHAR(36) NOT NULL,
  `card_number_masked` VARCHAR(19) NOT NULL,
  `card_holder_name` VARCHAR(100) NOT NULL,
  `expiry_date` VARCHAR(7) NOT NULL,
  `card_type` ENUM('DEBIT', 'CREDIT', 'VIRTUAL') NOT NULL DEFAULT 'DEBIT',
  `brand` ENUM('VISA', 'MASTERCARD') NOT NULL DEFAULT 'VISA',
  `status` ENUM('ACTIVE', 'INACTIVE', 'FROZEN') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cards_account` (`account_id`),
  CONSTRAINT `fk_cards_account` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------------------
-- 7. LOANS & CREDIT FACILITIES TABLE (CAR LOANS, MORTGAGES, PERSONAL)
-- ------------------------------------------------------------------------------
CREATE TABLE `loans` (
  `id` VARCHAR(36) NOT NULL,
  `account_id` VARCHAR(36) NOT NULL,
  `loan_reference` VARCHAR(32) NOT NULL,
  `loan_title` VARCHAR(100) NOT NULL,
  `loan_type` ENUM('PERSONAL', 'CAR_LOAN', 'MORTGAGE') NOT NULL DEFAULT 'PERSONAL',
  `principal_amount` DECIMAL(18, 4) NOT NULL,
  `interest_rate_apr` DECIMAL(6, 2) NOT NULL,
  `term_months` INT NOT NULL,
  `monthly_installment` DECIMAL(18, 4) NOT NULL,
  `remaining_balance` DECIMAL(18, 4) NOT NULL,
  `monthly_income` DECIMAL(18, 4) DEFAULT NULL,
  `asset_details` JSON DEFAULT NULL,
  `amortization_schedule` JSON DEFAULT NULL,
  `status` ENUM('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'ACTIVE', 'SETTLED', 'DEFAULTED') NOT NULL DEFAULT 'PENDING_APPROVAL',
  `disbursed_at` DATE DEFAULT NULL,
  `next_due_date` DATE DEFAULT NULL,
  `reviewed_by` VARCHAR(36) DEFAULT NULL,
  `reviewed_at` DATETIME DEFAULT NULL,
  `admin_remarks` TEXT DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_loans_ref` (`loan_reference`),
  KEY `idx_loans_account` (`account_id`),
  KEY `idx_loans_status` (`status`),
  CONSTRAINT `fk_loans_account` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------------------
-- 8. MULTI-CURRENCY WALLETS TABLE (USD, EUR, GBP, NGN)
-- ------------------------------------------------------------------------------
CREATE TABLE `wallets` (
  `id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `account_id` VARCHAR(36) NOT NULL,
  `currency` VARCHAR(3) NOT NULL,
  `balance` DECIMAL(18, 4) NOT NULL DEFAULT 0.0000,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_wallet_currency` (`user_id`, `currency`),
  KEY `idx_wallets_account` (`account_id`),
  CONSTRAINT `fk_wallets_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_wallets_account` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------------------
-- 9. EXCHANGE RATES TABLE (ADMIN EXCHANGE RATE MANAGER)
-- ------------------------------------------------------------------------------
CREATE TABLE `exchange_rates` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `from_currency` VARCHAR(3) NOT NULL,
  `to_currency` VARCHAR(3) NOT NULL,
  `rate` DECIMAL(18, 6) NOT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_exchange_pair` (`from_currency`, `to_currency`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------------------
-- 10. AUDIT LOGS TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE `audit_logs` (
  `id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) DEFAULT NULL,
  `event_type` VARCHAR(64) NOT NULL,
  `ip_address` VARCHAR(45) NOT NULL,
  `user_agent` VARCHAR(255) DEFAULT NULL,
  `metadata` JSON DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_audit_logs_user` (`user_id`),
  KEY `idx_audit_logs_event` (`event_type`),
  CONSTRAINT `fk_audit_logs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------------------
-- 11. CONTACT INQUIRIES TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE `contact_inquiries` (
  `id` VARCHAR(36) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `email` VARCHAR(150) NOT NULL,
  `phone` VARCHAR(30) DEFAULT NULL,
  `subject` VARCHAR(200) NOT NULL,
  `message` TEXT NOT NULL,
  `status` ENUM('NEW', 'IN_REVIEW', 'RESOLVED') NOT NULL DEFAULT 'NEW',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
