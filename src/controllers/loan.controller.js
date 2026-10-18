const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');

function calculateAmortization(principal, annualRate, months) {
  const monthlyRate = annualRate / 100 / 12;
  const monthlyInstallment = monthlyRate === 0 
    ? (principal / months) 
    : (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months));
  
  let balance = principal;
  const schedule = [];

  for (let month = 1; month <= months; month++) {
    const interest = balance * monthlyRate;
    const principalPaid = monthlyInstallment - interest;
    balance -= principalPaid;
    if (balance < 0) balance = 0;

    schedule.push({
      month,
      installment: parseFloat(monthlyInstallment.toFixed(2)),
      principal: parseFloat(principalPaid.toFixed(2)),
      interest: parseFloat(interest.toFixed(2)),
      remainingBalance: parseFloat(balance.toFixed(2))
    });
  }
  return { monthlyInstallment: parseFloat(monthlyInstallment.toFixed(2)), schedule };
}

// List Loans for User's Primary Account (with full status tracking & amortization)
async function listLoans(req, res) {
  try {
    const accountId = req.user.account.id;

    const [loans] = await pool.execute(
      `SELECT * FROM loans WHERE account_id = ? ORDER BY created_at DESC`,
      [accountId]
    );

    return res.status(200).json({
      success: true,
      status: 'SUCCESS',
      data: loans.map(l => ({
        id: l.id,
        reference: l.loan_reference,
        title: l.loan_title,
        loanType: l.loan_type,
        principalAmount: parseFloat(l.principal_amount).toFixed(2),
        interestRateApr: parseFloat(l.interest_rate_apr).toFixed(2),
        termMonths: l.term_months,
        monthlyInstallment: parseFloat(l.monthly_installment).toFixed(2),
        remainingBalance: parseFloat(l.remaining_balance).toFixed(2),
        monthlyIncome: l.monthly_income ? parseFloat(l.monthly_income).toFixed(2) : null,
        assetDetails: typeof l.asset_details === 'string' ? JSON.parse(l.asset_details) : l.asset_details,
        amortizationSchedule: typeof l.amortization_schedule === 'string' ? JSON.parse(l.amortization_schedule) : l.amortization_schedule,
        status: l.status,
        disbursedAt: l.disbursed_at,
        nextDueDate: l.next_due_date,
        adminRemarks: l.admin_remarks,
        createdAt: l.created_at
      }))
    });
  } catch (err) {
    console.error('Error in listLoans:', err);
    return res.status(500).json({
      success: false,
      status: 'SERVER_ERROR',
      message: 'Failed to retrieve loan records.'
    });
  }
}

// Customer submits Car Loan or Mortgage application
async function applyLoan(req, res) {
  try {
    const accountId = req.user.account.id;
    const {
      loanType = 'PERSONAL', // 'CAR_LOAN' | 'MORTGAGE' | 'PERSONAL'
      principalAmount,
      termMonths,
      monthlyIncome,
      assetDetails
    } = req.body;

    const principal = parseFloat(principalAmount);
    const months = parseInt(termMonths, 10);
    const income = parseFloat(monthlyIncome || 0);

    if (isNaN(principal) || principal <= 0 || isNaN(months) || months <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Principal amount and term in months must be valid positive numbers.'
      });
    }

    // Determine baseline interest rate based on loan type
    let apr = 5.50;
    let title = 'General Personal Credit Facility';
    let prefix = 'LN';

    if (loanType === 'CAR_LOAN') {
      apr = 6.20;
      const make = assetDetails?.make || 'Vehicle';
      const model = assetDetails?.model || 'Financing';
      title = `Auto Financing: ${make} ${model}`;
      prefix = 'LN-CAR';
    } else if (loanType === 'MORTGAGE') {
      apr = 4.80;
      const prop = assetDetails?.propertyType || 'Residential';
      title = `Prime Mortgage: ${prop}`;
      prefix = 'LN-MORT';
    }

    const { monthlyInstallment, schedule } = calculateAmortization(principal, apr, months);
    const ref = `${prefix}-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

    await pool.execute(
      `INSERT INTO loans (
        id, account_id, loan_reference, loan_title, loan_type, principal_amount, 
        interest_rate_apr, term_months, monthly_installment, remaining_balance, 
        monthly_income, asset_details, amortization_schedule, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_APPROVAL')`,
      [
        uuidv4(),
        accountId,
        ref,
        title,
        loanType,
        principal,
        apr,
        months,
        monthlyInstallment,
        principal,
        income,
        JSON.stringify(assetDetails || {}),
        JSON.stringify(schedule.slice(0, 12)) // Initial 12-month preview schedule
      ]
    );

    return res.status(201).json({
      success: true,
      message: `Your ${loanType.replace('_', ' ')} application (${ref}) has been submitted and is currently in review by the Credit Underwriting Committee.`,
      data: {
        loanReference: ref,
        title,
        loanType,
        principalAmount: principal.toFixed(2),
        interestRateApr: apr.toFixed(2),
        termMonths: months,
        monthlyInstallment: monthlyInstallment.toFixed(2),
        status: 'PENDING_APPROVAL'
      }
    });
  } catch (err) {
    console.error('Error in applyLoan:', err);
    return res.status(500).json({ success: false, message: 'Failed to submit loan application.' });
  }
}

// Public / Client Loan Calculator Engine
function calculateLoan(req, res) {
  try {
    const { amount, termYears = 3, termMonths, apr, rate } = req.body;

    const principal = parseFloat(amount || 10000);
    const months = termMonths ? parseInt(termMonths, 10) : Math.round(parseFloat(termYears || 3) * 12);
    const annualRate = parseFloat(apr !== undefined ? apr : (rate !== undefined ? rate : 5.5));

    if (isNaN(principal) || principal <= 0 || isNaN(months) || months <= 0) {
      return res.status(400).json({
        success: false,
        status: 'VALIDATION_ERROR',
        message: 'Valid positive amount and term are required.'
      });
    }

    const { monthlyInstallment, schedule } = calculateAmortization(principal, annualRate, months);
    const totalPayment = monthlyInstallment * months;
    const totalInterest = totalPayment - principal;

    return res.status(200).json({
      success: true,
      status: 'SUCCESS',
      data: {
        principal: principal.toFixed(2),
        termMonths: months,
        interestRateApr: annualRate.toFixed(2),
        monthlyPayment: monthlyInstallment,
        totalInterest: parseFloat(totalInterest.toFixed(2)),
        totalPayment: parseFloat(totalPayment.toFixed(2)),
        schedule: schedule.slice(0, 24) // 24-month preview
      }
    });
  } catch (err) {
    console.error('Error in calculateLoan:', err);
    return res.status(500).json({
      success: false,
      status: 'SERVER_ERROR',
      message: 'Failed to compute loan calculation.'
    });
  }
}

module.exports = {
  listLoans,
  applyLoan,
  calculateLoan
};
