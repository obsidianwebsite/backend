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

async function runFeatureVerification() {
  console.log('===============================================================');
  console.log(' OBSIDIAN TRUST BANK - EXTENDED FEATURE BOOK VERIFICATION');
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
    // 1. Authenticate Admin
    console.log('--- Step 1: Admin Authentication ---');
    const stage1 = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/v1/auth/login-stage1',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: 'admin@otbplcfin.com', password: 'AdminPassword123!' });

    const stage2 = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/v1/auth/verify-pin-stage2',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { pin: '9999', preAuthToken: stage1.body.preAuthToken });

    const adminToken = stage2.body.token;
    assert(adminToken !== undefined, 'Admin authenticated successfully');

    // 2. Authenticate Customer (demo user)
    console.log('\n--- Step 2: Customer Authentication ---');
    const cust1 = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/v1/auth/login-stage1',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: 'demo@otbplcfin.com', password: 'Password123!' });

    const cust2 = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/v1/auth/verify-pin-stage2',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { pin: '1234', preAuthToken: cust1.body.preAuthToken });

    const userToken = cust2.body.token;
    assert(userToken !== undefined, 'Customer authenticated successfully');

    // 3. Multi-Balance Check (Checking, Savings, Bonus, Investment ROI)
    console.log('\n--- Step 3: Account Multi-Balance Overview ---');
    const summary = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/v1/accounts/summary',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${userToken}` }
    });
    assert(summary.statusCode === 200, 'Account summary returned 200');
    assert(summary.body.data.account.savingsBalance !== undefined, 'Savings balance field present');
    assert(summary.body.data.account.bonusBalance !== undefined, 'Bonus balance field present');
    assert(summary.body.data.account.investmentEarnings !== undefined, 'Investment earnings field present');
    assert(summary.body.data.account.cotCode !== undefined, 'Clearance codes metadata present');

    // 4. Withdrawal Request & Admin Approval
    console.log('\n--- Step 4: Capital Withdrawal Escrow & Admin Approval ---');
    const withdrawReq = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/v1/withdrawals',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userToken}`
      }
    }, {
      amount: 50,
      method: 'BANK_WIRE',
      destinationDetails: 'JPMorgan Chase NA, Account #9928172918, Routing: 021000021'
    });
    assert(withdrawReq.statusCode === 201, 'Withdrawal request created in escrow (201)');
    const withdrawalId = withdrawReq.body.data.id;
    assert(withdrawReq.body.data.status === 'PENDING_APPROVAL', 'Withdrawal placed in PENDING_APPROVAL state');

    // Admin approve withdrawal
    const approveWithdrawal = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: `/api/v1/admin/withdrawals/${withdrawalId}/approve`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      }
    }, { adminRemarks: 'Digital asset escrow cleared by Admin Compliance Desk.' });
    assert(approveWithdrawal.statusCode === 200, 'Admin approved withdrawal successfully');

    // 5. Grant Application & Admin Disbursal
    console.log('\n--- Step 5: Grant Application & Direct Account Disbursement ---');
    const grantReq = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/v1/grants',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userToken}`
      }
    }, {
      programmeName: 'Sustainable Green Energy Grant',
      category: 'COMMUNITY_DEVELOPMENT',
      amountRequested: 5000,
      businessPurpose: 'Deploying high-efficiency solar battery stations.'
    });
    assert(grantReq.statusCode === 201, 'Grant application submitted (201)');
    const grantId = grantReq.body.data.id;

    // Admin disburse grant
    const disburseGrant = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: `/api/v1/admin/grants/${grantId}/review`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      }
    }, {
      action: 'DISBURSE',
      adminRemarks: 'Approved & disbursed under Sustainable Infrastructure Grant Program.'
    });
    assert(disburseGrant.statusCode === 200, 'Grant atomically disbursed into customer checking account');

    // 6. IRS Tax Refund Claim & Direct Deposit Disbursal
    console.log('\n--- Step 6: IRS Form 1040 Tax Refund Tracker & Disbursal ---');
    const taxReq = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/v1/tax-refunds',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userToken}`
      }
    }, {
      taxYear: '2025',
      filingStatus: 'SINGLE',
      expectedAmount: 3200,
      ssnTinMasked: '***-**-8812',
      notes: 'Form 1040 filed with standard deduction.'
    });
    assert(taxReq.statusCode === 201, 'Tax refund claim filed (201)');
    const taxClaimId = taxReq.body.data.id;

    // Advance tax claim to DISBURSED
    const disburseTax = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: `/api/v1/admin/tax-refunds/${taxClaimId}/stage`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      }
    }, {
      stage: 'DISBURSED',
      adminRemarks: 'IRS Direct Deposit electronic treasury transfer credited.'
    });
    assert(disburseTax.statusCode === 200, 'Tax refund direct deposit successfully disbursed to account');

    // 7. Institutional Investment Portfolio Subscription
    console.log('\n--- Step 7: Institutional Investment Plan Subscription ---');
    const plansRes = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/v1/investments/plans',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${userToken}` }
    });
    assert(plansRes.statusCode === 200, 'Investment catalog retrieved (200)');
    assert(plansRes.body.data.length > 0, 'Active investment plans available');
    const selectedPlan = plansRes.body.data[0];

    const subInvest = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/v1/investments/subscribe',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userToken}`
      }
    }, {
      planId: selectedPlan.id,
      amount: selectedPlan.min_amount
    });
    assert(subInvest.statusCode === 201, `Subscribed to ${selectedPlan.name} with ledger allocation`);

    // 8. Trading Signals & Copy Trading Masters
    console.log('\n--- Step 8: Signals Desk & Copy Trading ---');
    const signalsRes = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/v1/trading/signals',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${userToken}` }
    });
    assert(signalsRes.statusCode === 200, 'Trading signals fetched');
    assert(signalsRes.body.data.length > 0, 'Active trading signals found');

    const mastersRes = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/v1/trading/masters',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${userToken}` }
    });
    assert(mastersRes.statusCode === 200, 'MT4 Master traders fetched');
    assert(mastersRes.body.data.length > 0, 'Master traders profiles available');

    // 9. Financial Academy
    console.log('\n--- Step 9: Financial Academy Catalog ---');
    const coursesRes = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/v1/academy/courses',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${userToken}` }
    });
    assert(coursesRes.statusCode === 200, 'Financial Academy courses retrieved');
    assert(coursesRes.body.data.length > 0, 'Academy curriculum loaded');

    // 10. Admin Clearance Codes Configuration
    console.log('\n--- Step 10: Clearance Codes Update ---');
    const usersList = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/v1/admin/users',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const demo = usersList.body.data.find(u => u.email === 'demo@otbplcfin.com');

    const updateCodes = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: `/api/v1/admin/users/${demo.id}/clearance-codes`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      }
    }, {
      cotCode: 'COT-7749',
      taxCode: 'TAX-9921',
      imfCode: 'IMF-1102'
    });
    assert(updateCodes.statusCode === 200, 'Admin updated COT, Tax, and IMF Clearance Codes');

    // 11. Multi-Balance Adjustment (Savings Vault)
    console.log('\n--- Step 11: Admin Multi-Balance Adjustment ---');
    const adjustSavings = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: `/api/v1/admin/users/${demo.id}/balance`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      }
    }, {
      accountId: demo.account_id,
      balanceType: 'SAVINGS',
      type: 'CREDIT',
      amount: 1500,
      reason: 'Special high-yield savings bonus allocation'
    });
    assert(adjustSavings.statusCode === 200, 'Admin credited $1,500 into customer SAVINGS vault');

    console.log('\n===============================================================');
    console.log(` RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('===============================================================');

  } catch (error) {
    console.error('Fatal Test Exception:', error);
    process.exit(1);
  }
}

runFeatureVerification();
