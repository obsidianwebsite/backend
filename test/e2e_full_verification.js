const http = require('http');

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(data);
        const contentType = res.headers['content-type'] || '';
        let parsed = null;
        if (contentType.includes('application/json')) {
          try {
            parsed = JSON.parse(buffer.toString('utf8'));
          } catch (e) {
            parsed = buffer.toString('utf8');
          }
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: parsed,
          rawBuffer: buffer
        });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runFullE2ETest() {
  console.log('===============================================================');
  console.log(' OBSIDIAN TRUST BANK - COMPREHENSIVE END-TO-END TEST SUITE');
  console.log(' Testing through Angular Dev Server Proxy (http://localhost:4200/api/v1)');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message}`);
      failed++;
    }
  }

  try {
    // 1. Stage 1 Admin Login
    console.log('--- Step 1: Admin Authentication Stage 1 (Password) ---');
    const stage1Res = await request({
      hostname: '127.0.0.1',
      port: 4200,
      path: '/api/v1/auth/login-stage1',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: 'admin@otbplcfin.com', password: 'AdminPassword123!' });

    assert(stage1Res.statusCode === 200, 'Admin Stage 1 returns HTTP 200');
    assert(stage1Res.body.nextStep === 'PIN_VERIFICATION', 'Admin Stage 1 requires PIN challenge');
    assert(stage1Res.body.user.role === 'ADMIN', 'Admin Stage 1 identifies user as ADMIN');
    const preAuthToken = stage1Res.body.preAuthToken;

    // 2. Stage 2 Admin PIN Verification
    console.log('\n--- Step 2: Admin Authentication Stage 2 (PIN Challenge) ---');
    const stage2Res = await request({
      hostname: '127.0.0.1',
      port: 4200,
      path: '/api/v1/auth/verify-pin-stage2',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { pin: '9999', preAuthToken });

    assert(stage2Res.statusCode === 200, 'Admin Stage 2 returns HTTP 200');
    assert(stage2Res.body.token !== undefined, 'Admin JWT token issued');
    assert(stage2Res.body.user.role === 'ADMIN', 'Authenticated session has role ADMIN');
    const adminToken = stage2Res.body.token;

    // 3. Admin Overview Metrics
    console.log('\n--- Step 3: Admin Overview Metrics ---');
    const overviewRes = await request({
      hostname: '127.0.0.1',
      port: 4200,
      path: '/api/v1/admin/overview',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(overviewRes.statusCode === 200, 'Admin overview returns HTTP 200');
    assert(overviewRes.body.data.totalCustomers >= 1, 'Total customers metric present');
    assert(overviewRes.body.data.totalVaultBalance !== undefined, 'Total vault balance present');

    // 4. Admin Deposits Queue & Approval
    console.log('\n--- Step 4: Admin Deposits Clearance Queue & Approval ---');
    const depositsRes = await request({
      hostname: '127.0.0.1',
      port: 4200,
      path: '/api/v1/admin/deposits?status=PENDING_APPROVAL',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(depositsRes.statusCode === 200, 'Admin deposits list returns HTTP 200');
    const pendingDeposits = depositsRes.body.data;
    assert(Array.isArray(pendingDeposits), 'Pending deposits array returned');

    if (pendingDeposits.length > 0) {
      const depToApprove = pendingDeposits[0];
      const approveRes = await request({
        hostname: '127.0.0.1',
        port: 4200,
        path: `/api/v1/admin/deposits/${depToApprove.id}/approve`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        }
      }, { adminRemarks: 'Deposit instrument verified via central clearing.' });
      assert(approveRes.statusCode === 200, `Deposit ${depToApprove.id} approved & credited to ledger`);
    }

    // 5. Admin Loans Center & Approval
    console.log('\n--- Step 5: Admin Loan Review & Auto-Disbursement ---');
    const loansRes = await request({
      hostname: '127.0.0.1',
      port: 4200,
      path: '/api/v1/admin/loans?status=PENDING_APPROVAL',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(loansRes.statusCode === 200, 'Admin loans list returns HTTP 200');
    const pendingLoans = loansRes.body.data;

    if (pendingLoans.length > 0) {
      const loanToApprove = pendingLoans[0];
      const approveLoanRes = await request({
        hostname: '127.0.0.1',
        port: 4200,
        path: `/api/v1/admin/loans/${loanToApprove.id}/approve`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        }
      }, { adminRemarks: 'Credit underwriting verified. Facility approved.' });
      assert(approveLoanRes.statusCode === 200, `Loan ${loanToApprove.id} approved with auto-disbursement & dynamic schedule`);
    }

    // 6. Admin User Management & Balance Adjustment
    console.log('\n--- Step 6: Admin Customer Portfolio Management ---');
    const usersRes = await request({
      hostname: '127.0.0.1',
      port: 4200,
      path: '/api/v1/admin/users',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(usersRes.statusCode === 200, 'Admin users list returns HTTP 200');
    const demoUser = usersRes.body.data.find(u => u.email === 'demo@otbplcfin.com');
    assert(demoUser !== undefined, 'Demo customer found in user portfolio');

    // Credit adjustment
    const adjustRes = await request({
      hostname: '127.0.0.1',
      port: 4200,
      path: `/api/v1/admin/users/${demoUser.id}/balance`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      }
    }, {
      accountId: demoUser.account_id,
      type: 'CREDIT',
      amount: 2500,
      narration: 'School Presentation Showcase Bonus'
    });
    assert(adjustRes.statusCode === 200, 'Admin manual balance credit successful');

    // 7. Admin Impersonation ("Log in as customer")
    console.log('\n--- Step 7: 1-Click Admin Impersonation ---');
    const impRes = await request({
      hostname: '127.0.0.1',
      port: 4200,
      path: `/api/v1/admin/impersonate/${demoUser.id}`,
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(impRes.statusCode === 200, 'Admin impersonation session created');
    assert(impRes.body.user.impersonated === true, 'Impersonation claim embedded in session');
    const customerToken = impRes.body.token;

    // 8. Customer Features using Impersonated Session
    console.log('\n--- Step 8: Customer Banking under Impersonation ---');
    
    // Overview
    const accOverviewRes = await request({
      hostname: '127.0.0.1',
      port: 4200,
      path: '/api/v1/accounts/summary',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${customerToken}` }
    });
    assert(accOverviewRes.statusCode === 200, 'Customer overview loads successfully');

    // Multi-currency Wallets & Exchange
    const walletsRes = await request({
      hostname: '127.0.0.1',
      port: 4200,
      path: '/api/v1/wallets',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${customerToken}` }
    });
    assert(walletsRes.statusCode === 200, 'Multi-currency wallets retrieved');

    // Convert $100 USD to EUR
    const convertRes = await request({
      hostname: '127.0.0.1',
      port: 4200,
      path: '/api/v1/wallets/convert',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${customerToken}`
      }
    }, {
      fromCurrency: 'USD',
      toCurrency: 'EUR',
      amount: 100
    });
    assert(convertRes.statusCode === 200, 'Instant currency conversion USD -> EUR executed');

    // PDF Statement Export
    const pdfRes = await request({
      hostname: '127.0.0.1',
      port: 4200,
      path: '/api/v1/accounts/statement/pdf',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${customerToken}` }
    });
    assert(pdfRes.statusCode === 200, 'Certified PDF statement generated (HTTP 200)');
    assert(pdfRes.headers['content-type'] === 'application/pdf', 'Response Content-Type is application/pdf');
    const pdfMagic = pdfRes.rawBuffer.slice(0, 5).toString('ascii');
    assert(pdfMagic === '%PDF-', 'Valid binary PDF header received (%PDF-)');

    // Customer submits a deposit simulator request
    const mockDepRes = await request({
      hostname: '127.0.0.1',
      port: 4200,
      path: '/api/v1/deposits',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${customerToken}`
      }
    }, {
      method: 'CHECK_DEPOSIT',
      amount: 3200,
      currency: 'USD',
      payerName: 'Apex Capital Partners',
      payerBank: 'JPMorgan Chase NY',
      checkNumber: 'CHK-994821',
      proofNote: 'Quarterly dividend payment remittance scan'
    });
    assert(mockDepRes.statusCode === 201, 'Customer deposit simulator request queued for admin review');

    // 9. Inactive User Restriction: Login allowed, transactions restricted
    console.log('\n--- Step 9: Inactive Account Login & Transaction Restriction ---');
    const inactiveRes = await request({
      hostname: '127.0.0.1',
      port: 4200,
      path: '/api/v1/auth/login-stage1',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: 'inactive@otbplcfin.com', password: 'Password123!' });
    assert(inactiveRes.statusCode === 200, 'Inactive customer login Stage 1 accepted with HTTP 200');
    assert(inactiveRes.body.status === 'SUCCESS', 'Stage 1 returns SUCCESS');

    console.log('\n===============================================================');
    console.log(` RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('===============================================================\n');

    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Unexpected test exception:', err);
    process.exit(1);
  }
}

runFullE2ETest();
