const express = require('express');
const router = express.Router();

const { verifyAuth, verifyPreAuth, requireActiveAccount, verifyAdmin } = require('../middleware/auth.middleware');

const authController = require('../controllers/auth.controller');
const accountController = require('../controllers/account.controller');
const transferController = require('../controllers/transfer.controller');
const beneficiaryController = require('../controllers/beneficiary.controller');
const cardController = require('../controllers/card.controller');
const loanController = require('../controllers/loan.controller');
const settingsController = require('../controllers/settings.controller');
const supportController = require('../controllers/support.controller');
const adminController = require('../controllers/admin.controller');
const depositController = require('../controllers/deposit.controller');
const walletController = require('../controllers/wallet.controller');
const statementPdfController = require('../controllers/statement-pdf.controller');
const withdrawalController = require('../controllers/withdrawal.controller');
const grantController = require('../controllers/grant.controller');
const taxController = require('../controllers/tax.controller');
const investmentController = require('../controllers/investment.controller');
const tradingController = require('../controllers/trading.controller');
const academyController = require('../controllers/academy.controller');
const systemController = require('../controllers/system.controller');
const uploadController = require('../controllers/upload.controller');

// Health Check
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'HEALTHY', timestamp: new Date().toISOString() });
});

// Upload Routes (Public / Registration & General KYC)
router.post('/upload/kyc', uploadController.uploadKycImage);
router.post('/upload/image', uploadController.uploadKycImage);

router.post('/auth/login', authController.loginStage1);
router.post('/auth/login-stage1', authController.loginStage1);
router.post('/auth/verify-pin-stage2', verifyPreAuth, authController.verifyPinStage2);
router.post('/auth/register', authController.register);
router.get('/auth/me', verifyAuth, authController.getMe);

// -----------------------------------------------------------------------------
// 2. ACCOUNT & STATEMENT ROUTES (PROTECTED)
// -----------------------------------------------------------------------------
router.get('/accounts/summary', verifyAuth, accountController.getSummary);
router.get('/accounts/statement', verifyAuth, accountController.getStatement);
router.get('/accounts/statement/pdf', verifyAuth, statementPdfController.downloadStatementPdf);

// -----------------------------------------------------------------------------
// 3. FUNDS TRANSFER ROUTES (PROTECTED)
// -----------------------------------------------------------------------------
router.post('/transfers', verifyAuth, requireActiveAccount, transferController.createTransfer);
router.post('/transfers/internal', verifyAuth, requireActiveAccount, transferController.createInternalTransfer);

// -----------------------------------------------------------------------------
// 4. DEPOSIT SIMULATOR ROUTES (PROTECTED - CUSTOMER TO ADMIN QUEUE)
// -----------------------------------------------------------------------------
router.post('/deposits', verifyAuth, requireActiveAccount, depositController.createDeposit);
router.get('/deposits', verifyAuth, depositController.listUserDeposits);

// -----------------------------------------------------------------------------
// 5. WITHDRAWAL MODULE ROUTES (PROTECTED - CUSTOMER TO ADMIN QUEUE)
// -----------------------------------------------------------------------------
router.post('/withdrawals', verifyAuth, requireActiveAccount, withdrawalController.createWithdrawal);
router.get('/withdrawals', verifyAuth, withdrawalController.listUserWithdrawals);

// -----------------------------------------------------------------------------
// 6. CREDIT FACILITIES & LOANS (CAR LOANS, MORTGAGES, PERSONAL)
// -----------------------------------------------------------------------------
router.get('/loans', verifyAuth, loanController.listLoans);
router.post('/loans/apply', verifyAuth, loanController.applyLoan);
router.post('/loans/calculate', loanController.calculateLoan); // Public

// -----------------------------------------------------------------------------
// 7. GRANT APPLICATIONS MODULE
// -----------------------------------------------------------------------------
router.post('/grants', verifyAuth, grantController.applyGrant);
router.get('/grants', verifyAuth, grantController.listUserGrants);

// -----------------------------------------------------------------------------
// 8. TAX REFUND CLAIM & IRS TRACKER MODULE
// -----------------------------------------------------------------------------
router.post('/tax-refunds', verifyAuth, taxController.claimRefund);
router.get('/tax-refunds', verifyAuth, taxController.listUserRefunds);

// -----------------------------------------------------------------------------
// 9. INSTITUTIONAL INVESTMENT PLANS & ROI
// -----------------------------------------------------------------------------
router.get('/investments/plans', verifyAuth, investmentController.listPlans);
router.post('/investments/subscribe', verifyAuth, investmentController.subscribePlan);
router.get('/investments/my', verifyAuth, investmentController.listUserInvestments);

// -----------------------------------------------------------------------------
// 10. MT4 COPY TRADING & SIGNALS DESK
// -----------------------------------------------------------------------------
router.get('/trading/signals', verifyAuth, tradingController.listSignals);
router.get('/trading/masters', verifyAuth, tradingController.listMasters);
router.post('/trading/copy', verifyAuth, tradingController.subscribeMaster);
router.get('/trading/my-subscriptions', verifyAuth, tradingController.listUserSubscriptions);

// -----------------------------------------------------------------------------
// 11. FINANCIAL ACADEMY COURSES (PUBLIC / PROTECTED)
// -----------------------------------------------------------------------------
router.get('/academy/courses', academyController.listCourses);

// -----------------------------------------------------------------------------
// 12. MULTI-CURRENCY WALLETS (USD, EUR, GBP, NGN)
// -----------------------------------------------------------------------------
router.get('/wallets', verifyAuth, walletController.listWallets);
router.post('/wallets/convert', verifyAuth, walletController.convertCurrency);

// -----------------------------------------------------------------------------
// 13. BENEFICIARY MANAGEMENT ROUTES (PROTECTED)
// -----------------------------------------------------------------------------
router.get('/beneficiaries', verifyAuth, beneficiaryController.listBeneficiaries);
router.post('/beneficiaries', verifyAuth, beneficiaryController.addBeneficiary);
router.delete('/beneficiaries/:id', verifyAuth, beneficiaryController.deleteBeneficiary);

// -----------------------------------------------------------------------------
// 14. CARD MANAGEMENT ROUTES (PROTECTED)
// -----------------------------------------------------------------------------
router.get('/cards', verifyAuth, cardController.listCards);
router.patch('/cards/:id/status', verifyAuth, cardController.toggleCardStatus);
router.post('/cards/request', verifyAuth, cardController.requestCard);

// -----------------------------------------------------------------------------
// 15. SECURITY & SETTINGS ROTATION ROUTES (PROTECTED)
// -----------------------------------------------------------------------------
router.post('/settings/change-password', verifyAuth, settingsController.changePassword);
router.post('/settings/change-pin', verifyAuth, settingsController.changePin);

// -----------------------------------------------------------------------------
// 16. SUPPORT & INQUIRY ROUTES (PUBLIC, PROTECTED & ADMIN)
// -----------------------------------------------------------------------------
router.post('/support/contact', supportController.submitContactInquiry);

// User Support Tickets & AI Banking Chatbot
router.post('/support/tickets', verifyAuth, supportController.createTicket);
router.post('/support/email-admin', verifyAuth, supportController.sendSupportEmailToAdmin);
router.get('/support/tickets', verifyAuth, supportController.listUserTickets);
router.get('/support/tickets/:id', verifyAuth, supportController.getTicketDetails);
router.post('/support/tickets/:id/messages', verifyAuth, supportController.sendTicketMessage);
router.patch('/support/tickets/:id/close', verifyAuth, supportController.closeTicket);
router.post('/support/chatbot', verifyAuth, supportController.chatbotQuery);

// Admin Support Desk Management & Direct Replies
router.get('/admin/support/tickets', verifyAuth, verifyAdmin, supportController.listAdminTickets);
router.get('/admin/support/tickets/:id', verifyAuth, verifyAdmin, supportController.getAdminTicketDetails);
router.post('/admin/support/tickets/:id/reply', verifyAuth, verifyAdmin, supportController.replyAdminTicket);
router.patch('/admin/support/tickets/:id/status', verifyAuth, verifyAdmin, supportController.updateAdminTicketStatus);

// -----------------------------------------------------------------------------
// 17. MASTER ADMIN CONTROL CENTER ROUTES (/admin - RESTRICTED TO ADMIN ROLE)
// -----------------------------------------------------------------------------
router.get('/admin/overview', verifyAuth, verifyAdmin, adminController.getOverview);

// Deposits Queue
router.get('/admin/deposits', verifyAuth, verifyAdmin, adminController.listDeposits);
router.post('/admin/deposits/:id/approve', verifyAuth, verifyAdmin, adminController.approveDeposit);
router.post('/admin/deposits/:id/reject', verifyAuth, verifyAdmin, adminController.rejectDeposit);

// Withdrawals Queue
router.get('/admin/withdrawals', verifyAuth, verifyAdmin, withdrawalController.listAdminWithdrawals);
router.post('/admin/withdrawals/:id/approve', verifyAuth, verifyAdmin, withdrawalController.approveWithdrawal);
router.post('/admin/withdrawals/:id/reject', verifyAuth, verifyAdmin, withdrawalController.rejectWithdrawal);

// Loans Review Center
router.get('/admin/loans', verifyAuth, verifyAdmin, adminController.listLoans);
router.post('/admin/loans/:id/approve', verifyAuth, verifyAdmin, adminController.approveLoan);
router.post('/admin/loans/:id/reject', verifyAuth, verifyAdmin, adminController.rejectLoan);

// Grants Review Center
router.get('/admin/grants', verifyAuth, verifyAdmin, grantController.listAdminGrants);
router.post('/admin/grants/:id/review', verifyAuth, verifyAdmin, grantController.reviewGrant);

// Tax Refund Center
router.get('/admin/tax-refunds', verifyAuth, verifyAdmin, taxController.listAdminTaxClaims);
router.patch('/admin/tax-refunds/:id/stage', verifyAuth, verifyAdmin, taxController.updateTaxStage);

// Investments Management
router.get('/admin/investments', verifyAuth, verifyAdmin, investmentController.listAllInvestments);
router.post('/admin/investments/plans', verifyAuth, verifyAdmin, investmentController.createPlan);

// Trading Signals Desk
router.post('/admin/trading/signals', verifyAuth, verifyAdmin, tradingController.publishSignal);
router.delete('/admin/trading/signals/:id', verifyAuth, verifyAdmin, tradingController.deleteSignal);

// User & Account Management
router.get('/admin/users', verifyAuth, verifyAdmin, adminController.listUsers);
router.patch('/admin/users/:id/status', verifyAuth, verifyAdmin, adminController.toggleUserStatus);
router.patch('/admin/users/:id/kyc', verifyAuth, verifyAdmin, adminController.updateUserKyc);
router.patch('/admin/users/:id/clearance-codes', verifyAuth, verifyAdmin, adminController.updateClearanceCodes);
router.post('/admin/users/:id/balance', verifyAuth, verifyAdmin, adminController.adjustBalance);
router.post('/admin/users/:id/reset-pin', verifyAuth, verifyAdmin, adminController.resetUserPin);

// Transaction History Generator & Custom Historical Entry
router.post('/admin/users/:id/generate-history', verifyAuth, verifyAdmin, adminController.generateTransactionHistory);
router.post('/admin/users/:id/custom-transaction', verifyAuth, verifyAdmin, adminController.insertCustomTransaction);
router.get('/admin/users/:id/transactions', verifyAuth, verifyAdmin, adminController.getUserTransactions);
router.delete('/admin/transactions/:transactionId', verifyAuth, verifyAdmin, adminController.deleteTransaction);

// Admin Impersonation
router.post('/admin/impersonate/:userId', verifyAuth, verifyAdmin, adminController.impersonateUser);

// Exchange Rate Manager
router.get('/admin/rates', verifyAuth, verifyAdmin, adminController.listExchangeRates);
router.put('/admin/rates', verifyAuth, verifyAdmin, adminController.updateExchangeRate);

// Resend Email Diagnostics, Custom Dispatch & Verification
const emailService = require('../services/email.service');
router.post('/admin/email/send-custom', verifyAuth, verifyAdmin, adminController.sendCustomEmail);
router.post('/admin/email/test', verifyAuth, verifyAdmin, async (req, res) => {
  const targetEmail = req.body.to || req.user.email;
  const result = await emailService.sendTestEmail({ to: targetEmail });
  return res.json({
    success: result.success,
    data: result,
    message: result.success
      ? (result.simulated ? 'Test email simulated (add RESEND_API_KEY in .env for live sending).' : `Live test email dispatched via Resend to ${targetEmail}!`)
      : (result.error?.message || 'Failed to send test email via Resend.')
  });
});

// System Settings & Branding Configuration
router.get('/system/settings', systemController.getSettings);
router.put('/admin/system/settings', verifyAuth, verifyAdmin, systemController.updateSettings);

module.exports = router;
