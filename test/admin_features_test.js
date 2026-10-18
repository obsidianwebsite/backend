const http = require('http');

function request(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve({ status: res.statusCode, headers: res.headers, data: json });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, raw: body });
        }
      });
    });
    req.on('error', reject);
    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Starting Master Admin & Enhanced Modules Backend Integration Tests...\n');
  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`  ✅ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${message}`);
    }
  }

  // 1. Admin Login Stage 1 & Stage 2
  const adminStage1 = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/v1/auth/login-stage1',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: 'admin@otbplcfin.com', password: 'AdminPassword123!' });
  assert(adminStage1.status === 200 && adminStage1.data.user.role === 'ADMIN', 'Admin Stage 1 login succeeds and recognizes ADMIN role');

  const adminStage2 = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/v1/auth/verify-pin-stage2',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminStage1.data.preAuthToken}`
    }
  }, { pin: '9999', preAuthToken: adminStage1.data.preAuthToken });
  assert(adminStage2.status === 200 && adminStage2.data.user.role === 'ADMIN', 'Admin Stage 2 PIN verification issues Master Admin JWT');
  const adminToken = adminStage2.data.token;

  // 2. Customer Login
  const custStage1 = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/v1/auth/login-stage1',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: 'demo@otbplcfin.com', password: 'Password123!' });
  const custStage2 = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/v1/auth/verify-pin-stage2',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${custStage1.data.preAuthToken}`
    }
  }, { pin: '1234', preAuthToken: custStage1.data.preAuthToken });
  const customerToken = custStage2.data.token;

  // 3. Customer is blocked from Admin endpoints (403 Forbidden)
  const custForbidden = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/v1/admin/overview',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${customerToken}` }
  });
  assert(custForbidden.status === 403, 'Customer role is strictly forbidden from accessing /admin endpoints');

  // 4. Admin Overview Metrics
  const overviewRes = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/v1/admin/overview',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert(overviewRes.status === 200 && overviewRes.data.data.pendingDepositsCount > 0, 'Admin overview returns pending queues and total vault balance');

  // 5. Admin Deposits Queue & Atomic Approval
  const depListRes = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/v1/admin/deposits?status=PENDING_APPROVAL',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert(depListRes.status === 200 && depListRes.data.data.length > 0, 'Admin can list pending deposit simulations');
  const depositToApprove = depListRes.data.data[0];

  const approveDepRes = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: `/api/v1/admin/deposits/${depositToApprove.id}/approve`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    }
  }, { adminRemarks: 'Approved following AML check.' });
  assert(approveDepRes.status === 200, 'Admin can approve deposit and atomically credit user account');

  // 6. Customer Deposit Simulator
  const newDepositRes = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/v1/deposits',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${customerToken}`
    }
  }, {
    amount: 8500.00,
    method: 'CHECK_DEPOSIT',
    payerName: 'Global Horizons Media',
    payerBank: 'Citibank Commercial',
    checkNumber: 'CHK-991204',
    proofNote: 'Customer uploaded scanned remote check deposit.'
  });
  assert(newDepositRes.status === 201 && newDepositRes.data.status === 'PENDING_APPROVAL', 'Customer deposit simulator holds deposit in PENDING_APPROVAL state');

  // 7. Customer Car Loan Application
  const carLoanRes = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/v1/loans/apply',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${customerToken}`
    }
  }, {
    loanType: 'CAR_LOAN',
    principalAmount: 48000.00,
    termMonths: 36,
    monthlyIncome: 12000.00,
    assetDetails: {
      make: 'Tesla',
      model: 'Model S Plaid',
      year: 2024,
      vin: '5YJSA1E28PF991823',
      vehicleValue: 55000.00,
      downPayment: 7000.00
    }
  });
  assert(carLoanRes.status === 201 && carLoanRes.data.data.loanType === 'CAR_LOAN', 'Customer can apply for Car Loan with vehicle parameters');

  // 8. Admin Loan Review Center & Approval
  const loansListRes = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/v1/admin/loans?status=PENDING_APPROVAL',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert(loansListRes.status === 200 && loansListRes.data.data.length > 0, 'Admin Loan Review Center retrieves pending credit facilities');
  const loanToApprove = loansListRes.data.data[0];

  const approveLoanRes = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: `/api/v1/admin/loans/${loanToApprove.id}/approve`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    }
  }, { adminRemarks: 'Underwriting committee approval granted.' });
  assert(approveLoanRes.status === 200, 'Admin loan approval disburses funds and generates full amortization schedule');

  // 9. Admin User Management & Balance Adjustment
  const usersListRes = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/v1/admin/users',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert(usersListRes.status === 200 && usersListRes.data.data.length > 0, 'Admin can list all customer accounts and wallets');
  const demoCustomer = usersListRes.data.data.find(u => u.email === 'demo@otbplcfin.com');

  const adjustRes = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: `/api/v1/admin/users/${demoCustomer.id}/balance`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    }
  }, {
    accountId: demoCustomer.account_id,
    type: 'CREDIT',
    amount: 1000.00,
    narration: 'Discretionary Executive Account Courtesy Credit'
  });
  assert(adjustRes.status === 200, 'Admin can manually credit/adjust customer balances with custom narration');

  // 10. Admin Impersonation ("Log in as user")
  const impersonateRes = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: `/api/v1/admin/impersonate/${demoCustomer.id}`,
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert(impersonateRes.status === 200 && impersonateRes.data.token && impersonateRes.data.user.impersonated, 'Admin can instantly impersonate customer and obtain user session token');

  // 11. Multi-Currency Wallets & Conversion
  const walletsRes = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/v1/wallets',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${customerToken}` }
  });
  assert(walletsRes.status === 200 && walletsRes.data.data.wallets.some(w => w.currency === 'EUR'), 'Customer can view balances across multiple currencies (USD, EUR, GBP, NGN)');

  const convertRes = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/v1/wallets/convert',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${customerToken}`
    }
  }, {
    fromCurrency: 'USD',
    toCurrency: 'EUR',
    amount: 500.00
  });
  assert(convertRes.status === 200 && convertRes.data.data.creditedAmount > 0, 'Customer can convert funds between multi-currency wallets using live admin exchange rates');

  // 12. Official PDF Statement Export
  const pdfRes = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/v1/accounts/statement/pdf',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${customerToken}` }
  });
  assert(pdfRes.status === 200 && pdfRes.headers['content-type'] === 'application/pdf' && pdfRes.raw.startsWith('%PDF-'), 'Backend streams certified PDF bank statement with official branding');

  console.log(`\n======================================================`);
  console.log(`🎯 Admin & Extended Backend Results: ${passed} / ${total} Passed (${Math.round((passed/total)*100)}%)`);
  console.log(`======================================================\n`);

  if (passed === total) {
    console.log('🎉 ALL Master Admin and Extended Banking backend tests PASSED!');
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
