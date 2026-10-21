const http = require('http');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const app = require('../src/app');

let server;
const PORT = 5088; // Use dedicated test port

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };
    if (data) {
      reqHeaders['Content-Length'] = Buffer.byteLength(data);
    }

    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        path,
        method,
        headers: reqHeaders
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        });
      }
    );

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function runTests() {
  console.log('🧪 =========================================================');
  console.log('🧪  STARTING OBSIDIAN TRUST BANK BACKEND INTEGRATION TESTS');
  console.log('🧪 =========================================================\n');

  server = app.listen(PORT);
  let passCount = 0;
  let failCount = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ [PASS] ${message}`);
      passCount++;
    } else {
      console.error(`  ❌ [FAIL] ${message}`);
      failCount++;
    }
  }

  try {
    // 1. Healthcheck
    console.log('👉 [1/14] Testing /health');
    const health = await request('GET', '/health');
    assert(health.status === 200 && health.body.status === 'ONLINE', 'Healthcheck returns 200 ONLINE');

    // 2. Public Loan Calculation Engine
    console.log('\n👉 [2/14] Testing /api/v1/loans/calculate (Public)');
    const loanCalc = await request('POST', '/api/v1/loans/calculate', { amount: 25000, termYears: 3, apr: 4.5 });
    assert(loanCalc.status === 200, 'Loan calculation returns HTTP 200');
    assert(loanCalc.body.data.monthlyPayment > 0, `Computed Monthly Installment: $${loanCalc.body.data.monthlyPayment}`);

    // 3. Public Contact Form
    console.log('\n👉 [3/14] Testing /api/v1/support/contact (Public)');
    const contact = await request('POST', '/api/v1/support/contact', {
      name: 'Victoria Sterling',
      email: 'v.sterling@holdings.co.uk',
      phone: '+44 20 7946 0888',
      subject: 'Corporate Escrow Service Inquiry',
      message: 'Requesting consultation on multi-currency institutional escrow accounts.'
    });
    assert(contact.status === 201 && contact.body.status === 'SUCCESS', 'Contact inquiry saved with 201 Created');

    // 4. Inactive Account Stage 1 Login & Transaction Restriction Verification
    console.log('\n👉 [4/14] Testing INACTIVE account: Allowed to login, blocked from transactions');
    const inactiveLogin = await request('POST', '/api/v1/auth/login-stage1', {
      email: 'inactive@otbplcfin.com',
      password: 'Password123!'
    });
    assert(inactiveLogin.status === 200 && inactiveLogin.body.status === 'SUCCESS', 'Inactive account correctly allowed to login Stage 1');
    assert(inactiveLogin.body.nextStep === 'PIN_VERIFICATION', 'Inactive account progresses to PIN_VERIFICATION');
    assert(!!inactiveLogin.body.preAuthToken, 'Inactive account receives pre-auth token');

    const inactiveStage2 = await request('POST', '/api/v1/auth/verify-pin-stage2', {
      pin: '1234',
      preAuthToken: inactiveLogin.body.preAuthToken
    });
    assert(inactiveStage2.status === 200 && inactiveStage2.body.status === 'SUCCESS', 'Inactive account completes Stage 2');
    const inactiveToken = inactiveStage2.body.token;
    const inactiveHeaders = { 'Authorization': `Bearer ${inactiveToken}` };

    const inactiveTransfer = await request('POST', '/api/v1/transfers', {
      rname: 'Alice Smith',
      rbank: 'Citibank N.A.',
      iban: 'US89370400440532013000',
      accno: '9876543210',
      swift: 'CITIUS33',
      type: 'LT',
      amt: 100,
      comment: 'Test from inactive account'
    }, inactiveHeaders);
    assert(inactiveTransfer.status === 403 && inactiveTransfer.body.status === 'ACCOUNT_INACTIVE', 'Inactive transfer blocked with 403 ACCOUNT_INACTIVE');

    const inactiveDeposit = await request('POST', '/api/v1/deposits', {
      amount: 500,
      method: 'BANK_TRANSFER',
      payerName: 'Test Payer',
      payerBank: 'Test Bank'
    }, inactiveHeaders);
    assert(inactiveDeposit.status === 403 && inactiveDeposit.body.status === 'ACCOUNT_INACTIVE', 'Inactive deposit blocked with 403 ACCOUNT_INACTIVE');

    const inactiveWithdrawal = await request('POST', '/api/v1/withdrawals', {
      amount: 100,
      method: 'BANK_WIRE',
      destinationDetails: 'Test Routing 123456789'
    }, inactiveHeaders);
    assert(inactiveWithdrawal.status === 403 && inactiveWithdrawal.body.status === 'ACCOUNT_INACTIVE', 'Inactive withdrawal blocked with 403 ACCOUNT_INACTIVE');

    // 5. Active User Stage 1 Login
    console.log('\n👉 [5/14] Testing /api/v1/auth/login-stage1 with active demo credentials');
    const stage1 = await request('POST', '/api/v1/auth/login-stage1', {
      email: 'demo@otbplcfin.com',
      password: 'Password123!'
    });
    assert(stage1.status === 200 && stage1.body.status === 'SUCCESS', 'Stage 1 login returns 200 SUCCESS');
    assert(stage1.body.nextStep === 'PIN_VERIFICATION', 'Next step is PIN_VERIFICATION');
    assert(!!stage1.body.preAuthToken, 'Pre-Auth temporary token generated');
    const preAuthToken = stage1.body.preAuthToken;

    // 6. Stage 2 PIN Challenge - Incorrect PIN
    console.log('\n👉 [6/14] Testing /api/v1/auth/verify-pin-stage2 with wrong PIN');
    const wrongPin = await request('POST', '/api/v1/auth/verify-pin-stage2', {
      preAuthToken,
      pin: '9999'
    });
    assert(wrongPin.status === 401 && wrongPin.body.status === 'INVALID_PIN', 'Wrong PIN rejected with 401 INVALID_PIN');

    // 7. Stage 2 PIN Challenge - Correct PIN '1234'
    console.log('\n👉 [7/14] Testing /api/v1/auth/verify-pin-stage2 with correct PIN (1234)');
    const stage2 = await request('POST', '/api/v1/auth/verify-pin-stage2', {
      preAuthToken,
      pin: '1234'
    });
    assert(stage2.status === 200 && stage2.body.status === 'SUCCESS', 'Stage 2 returns 200 SUCCESS');
    assert(!!stage2.body.token, 'Full session Bearer JWT token issued');
    const sessionToken = stage2.body.token;
    const authHeaders = { Authorization: `Bearer ${sessionToken}` };

    // 8. Auth /me Context
    console.log('\n👉 [8/14] Testing /api/v1/auth/me');
    const me = await request('GET', '/api/v1/auth/me', null, authHeaders);
    assert(me.status === 200 && me.body.user.email === 'demo@otbplcfin.com', 'Fetched user profile matching demo user');

    // 9. Accounts Summary
    console.log('\n👉 [9/14] Testing /api/v1/accounts/summary');
    const summary = await request('GET', '/api/v1/accounts/summary', null, authHeaders);
    assert(summary.status === 200, 'Accounts summary returns 200 OK');
    assert(summary.body.data.account.accountNumber === 'OTB-8839201948', 'Correct Account Number OTB-8839201948');
    assert(summary.body.data.account.percentageChange === '+1.2%', 'Includes +1.2% percentage-delta metric');
    console.log(`     Available Balance: $${summary.body.data.account.availableBalance}`);

    // 10. Accounts Statement & History
    console.log('\n👉 [10/14] Testing /api/v1/accounts/statement');
    const stmt = await request('GET', '/api/v1/accounts/statement?limit=10', null, authHeaders);
    assert(stmt.status === 200 && stmt.body.data.transactions.length > 0, `Retrieved ${stmt.body.data.transactions.length} historical statement entries`);

    // 11. Beneficiaries CRUD
    console.log('\n👉 [11/14] Testing /api/v1/beneficiaries (List & Add)');
    const bens = await request('GET', '/api/v1/beneficiaries', null, authHeaders);
    assert(bens.status === 200 && bens.body.data.length >= 3, `Found ${bens.body.data.length} saved beneficiaries`);

    const addBen = await request('POST', '/api/v1/beneficiaries', {
      name: 'Elena Rostova Trust',
      bankName: 'Credit Suisse Zurich',
      accountNumber: 'CH5604835012345678901',
      swiftRouting: 'CRESCHZZ',
      bankAddress: 'Paradeplatz 8, Zurich, Switzerland'
    }, authHeaders);
    assert(addBen.status === 201 && addBen.body.status === 'SUCCESS', 'New beneficiary created with 201');

    // 12. Cards Management
    console.log('\n👉 [12/14] Testing /api/v1/cards (List & Freeze/Activate Toggle)');
    const cards = await request('GET', '/api/v1/cards', null, authHeaders);
    assert(cards.status === 200 && cards.body.data.length >= 2, `Retrieved ${cards.body.data.length} customer cards`);
    const targetCardId = cards.body.data[0].id;

    const freezeCard = await request('PATCH', `/api/v1/cards/${targetCardId}/status`, { status: 'FROZEN' }, authHeaders);
    assert(freezeCard.status === 200 && freezeCard.body.data.status === 'FROZEN', 'Card status successfully toggled to FROZEN');

    const unfreezeCard = await request('PATCH', `/api/v1/cards/${targetCardId}/status`, { status: 'ACTIVE' }, authHeaders);
    assert(unfreezeCard.status === 200 && unfreezeCard.body.data.status === 'ACTIVE', 'Card status successfully reactivated to ACTIVE');

    // 13. Loans Retrieval
    console.log('\n👉 [13/14] Testing /api/v1/loans');
    const loans = await request('GET', '/api/v1/loans', null, authHeaders);
    assert(loans.status === 200 && loans.body.data.length >= 1, `Found active loan facility: ${loans.body.data[0].reference}`);

    // 14. Funds Transfer Execution
    console.log('\n👉 [14/14] Testing /api/v1/transfers (Execute Transfer with Debit & Ledger)');
    const initialBal = parseFloat(summary.body.data.account.availableBalance);
    const transferPayload = {
      rname: 'Geneva Private Wealth SA',
      rbank: 'UBS Switzerland AG',
      iban: 'CH9300240240123456789',
      accno: '9840291034',
      swift: 'UBSWCHZH',
      type: 'DT', // Domestic Transfer, $5 fee
      amt: '500.00',
      comment: 'Quarterly Retainer Disbursal',
      saveBeneficiary: false
    };

    const transferRes = await request('POST', '/api/v1/transfers', transferPayload, authHeaders);
    assert(transferRes.status === 200 && transferRes.body.status === 'SUCCESS', 'Transfer successfully processed and committed');
    assert(!!transferRes.body.data.referenceNumber, `Generated transaction reference: ${transferRes.body.data.referenceNumber}`);
    
    const newBal = parseFloat(transferRes.body.data.remainingBalance);
    const expectedBal = initialBal - 505.00; // $500 + $5 fee
    assert(Math.abs(newBal - expectedBal) < 0.01, `Balance correctly debited: Was $${initialBal.toFixed(2)}, Now $${newBal.toFixed(2)} (Expected $${expectedBal.toFixed(2)})`);

    console.log('\n=========================================================');
    console.log(`🏁 INTEGRATION TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
    console.log('=========================================================\n');

    server.close();
    process.exit(failCount > 0 ? 1 : 0);
  } catch (err) {
    console.error('💥 Test Suite Fatal Exception:', err);
    process.exit(1);
  }
}

runTests();
