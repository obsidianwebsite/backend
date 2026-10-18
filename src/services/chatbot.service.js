const pool = require('../config/db');

/**
 * VaultAtlantic Bank Plc - VaultBot AI Banking Intelligence Engine
 * Handles complex institutional banking queries, personal account analytics,
 * regulatory compliance explanations, clearance codes, and transactional navigation.
 */

// Helper to format currency values
function formatMoney(amount, currency = 'USD') {
  const num = parseFloat(amount || 0);
  const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : `${currency} `;
  return `${symbol}${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Format date helper
function formatDate(dateStr) {
  if (!dateStr) return 'Recent';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch (e) {
    return String(dateStr);
  }
}

/**
 * Gather rich context for the logged-in user and bank settings
 */
async function getChatbotContext(userId) {
  // 1. Fetch User & Primary Account details
  const [accountRows] = await pool.execute(`
    SELECT a.id, a.account_number, a.account_type, a.currency, 
           a.available_balance, a.ledger_balance, a.savings_balance, 
           a.bonus_balance, a.investment_earnings, a.cot_code, 
           a.tax_code, a.imf_code, a.status,
           u.first_name, u.last_name, u.email, u.phone, u.kyc_status, u.role
    FROM accounts a
    JOIN users u ON u.id = a.user_id
    WHERE a.user_id = ?
    LIMIT 1
  `, [userId]);

  const userAcc = accountRows[0] || {};
  const accountId = userAcc.id;

  // 2. Fetch System & Bank Settings
  let settings = {
    site_name: 'VaultAtlantic Bank Plc',
    site_tagline: 'Commercial Banking & Institutional Treasury',
    contact_email: 'support@vaultatlantic.com',
    admin_notification_email: 'admin@vaultatlantic.com',
    phone_number: '+44 20 7946 0912',
    address: '12 Bridlesmith Walk, Nottingham, NG1 2HB, United Kingdom',
    swift_code: 'VAUTGB2L',
    routing_number: '026009593',
    currency_code: 'USD',
    currency_symbol: '$',
    support_hours: '24/7 Global Treasury Support Desk'
  };

  try {
    const [settingsRows] = await pool.execute(`
      SELECT * FROM system_settings WHERE id = 'main_settings' LIMIT 1
    `);
    if (settingsRows && settingsRows.length > 0) {
      settings = { ...settings, ...settingsRows[0] };
    }
  } catch (err) {}

  // 3. Fetch Recent Transactions
  let recentTx = null;
  if (accountId) {
    try {
      const [txRows] = await pool.execute(`
        SELECT reference_number, transaction_type, channel, amount, fee, currency, 
               counterparty_name, counterparty_bank, post_date, status, narration
        FROM transactions
        WHERE account_id = ?
        ORDER BY post_date DESC
        LIMIT 1
      `, [accountId]);
      if (txRows.length > 0) {
        recentTx = txRows[0];
      }
    } catch (err) {}
  }

  // 4. Fetch Active Cards & Loans Count
  let cardCount = 0;
  let loanCount = 0;
  if (accountId) {
    try {
      const [[cards]] = await pool.execute(
        `SELECT COUNT(id) as cnt FROM cards WHERE account_id = ? AND status = 'ACTIVE'`,
        [accountId]
      );
      cardCount = cards ? cards.cnt : 0;
    } catch (err) {}

    try {
      const [[loans]] = await pool.execute(
        `SELECT COUNT(id) as cnt FROM loans WHERE account_id = ? AND status = 'ACTIVE'`,
        [accountId]
      );
      loanCount = loans ? loans.cnt : 0;
    } catch (err) {}
  }

  return {
    user: userAcc,
    settings,
    recentTx,
    cardCount,
    loanCount
  };
}

/**
 * Optional Generative LLM Integration (Gemini / OpenAI)
 * Triggered automatically if GEMINI_API_KEY or OPENAI_API_KEY is configured in process.env.
 */
async function callGenerativeLLM(query, ctx) {
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!geminiKey && !openaiKey) {
    return null;
  }

  const { user, settings, recentTx, cardCount, loanCount } = ctx;
  const currency = user.currency || settings.currency_code || 'USD';

  const systemPrompt = `You are "VaultBot AI", the elite, sovereign AI Banking Concierge & Financial Assistant for ${settings.site_name}.
You represent a premier British commercial banking and institutional treasury institution headquartered at ${settings.address}.
Your tone is sophisticated, polite, authoritative, highly knowledgeable, and welcoming. You speak in concise, executive English with clear formatting (bullet points, bold text).
Never mention cryptocurrency or unofficial fintech slang; adhere strictly to commercial banking, treasury, SWIFT clearing, and financial regulations.

CURRENT CLIENT CONTEXT:
- Client Name: ${user.first_name || 'Client'} ${user.last_name || ''}
- Role: ${user.role || 'USER'}
- Account Number: #${user.account_number || 'Pending Provision'}
- Account Type: ${user.account_type || 'Commercial Checking'}
- Available Balance: ${formatMoney(user.available_balance, currency)}
- Ledger Balance: ${formatMoney(user.ledger_balance, currency)}
- Savings Balance: ${formatMoney(user.savings_balance, currency)}
- Investment Earnings: ${formatMoney(user.investment_earnings, currency)}
- COT Clearance Code: ${user.cot_code || 'COT-7749'}
- IMF Clearance Code: ${user.imf_code || 'IMF-9904'}
- Tax Clearance Code: ${user.tax_code || 'TAX-8821'}
- KYC Status: ${user.kyc_status || 'VERIFIED'}
- Active Payment Cards: ${cardCount}
- Active Loan Facilities: ${loanCount}
${recentTx ? `- Latest Transaction: ${recentTx.transaction_type} of ${formatMoney(recentTx.amount, recentTx.currency)} to/from ${recentTx.counterparty_name || 'Counterparty'} on ${formatDate(recentTx.post_date)} (Status: ${recentTx.status}, Ref: ${recentTx.reference_number})` : ''}

INSTITUTIONAL BANKING DETAILS:
- Bank Name: ${settings.site_name}
- SWIFT / BIC Code: ${settings.swift_code}
- Routing Number: ${settings.routing_number}
- Head Office: ${settings.address}
- Telephone: ${settings.phone_number}
- Official Support Email: ${settings.contact_email}
- Regulatory Status: Authorized & regulated commercial banking institution. FSCS protected.

INSTRUCTIONS:
1. Answer the user's question with utmost financial intelligence, whether it is a simple query (e.g. balance, routing number) or a complex query (e.g. SWIFT clearing protocols, COT code statutory requirements, tax refund stages, investment yields, mortgage amortization).
2. If the user asks about their own account, cite their exact numbers.
3. Be concise and crisp. Avoid unnecessary fluff. Use markdown lists where appropriate.`;

  // Try Gemini First if key exists
  if (geminiKey) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\nClient Query: "${query}"` }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 650 }
        }),
        signal: AbortSignal.timeout(6000)
      });

      if (resp.ok) {
        const data = await resp.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text && text.trim()) {
          return {
            reply: text.trim(),
            category: 'GENERATIVE_AI',
            suggestedActions: [
              { label: 'Check Account Balance', link: '/e-banking/overview' },
              { label: 'Send Funds Wire', link: '/e-banking/fund-transfer' },
              { label: 'Support Desk', link: '/e-banking/support' }
            ],
            canEscalateToHuman: query.toLowerCase().includes('agent') || query.toLowerCase().includes('human')
          };
        }
      }
    } catch (err) {
      console.warn('[VaultBot LLM] Gemini call failed, continuing with built-in engine:', err.message);
    }
  }

  // Try OpenAI if configured
  if (openaiKey) {
    try {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: query }
          ],
          temperature: 0.3,
          max_tokens: 650
        }),
        signal: AbortSignal.timeout(6000)
      });

      if (resp.ok) {
        const data = await resp.json();
        const text = data?.choices?.[0]?.message?.content;
        if (text && text.trim()) {
          return {
            reply: text.trim(),
            category: 'GENERATIVE_AI',
            suggestedActions: [
              { label: 'Account Overview', link: '/e-banking/overview' },
              { label: 'Transfer Desk', link: '/e-banking/fund-transfer' },
              { label: 'Support Desk', link: '/e-banking/support' }
            ],
            canEscalateToHuman: query.toLowerCase().includes('agent') || query.toLowerCase().includes('human')
          };
        }
      }
    } catch (err) {
      console.warn('[VaultBot LLM] OpenAI call failed, continuing with built-in engine:', err.message);
    }
  }

  return null;
}

/**
 * Built-In Autonomous Banking Intelligence Engine
 * 32 Comprehensive Domain Intents with Weighted Multi-Keyword Semantic Scoring
 */
function processBuiltInQuery(query, ctx) {
  const { user, settings, recentTx, cardCount, loanCount } = ctx;
  const q = query.toLowerCase().trim();
  const currency = user.currency || settings.currency_code || 'USD';
  const firstName = user.first_name || 'Valued Client';
  const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Client';

  // Helper score calculator
  function scoreIntent(phrases, singleWords, regexes = []) {
    let score = 0;
    for (const phrase of phrases) {
      if (q.includes(phrase.toLowerCase())) {
        score += 8;
      }
    }
    for (const word of singleWords) {
      const re = new RegExp(`\\b${word}\\b`, 'i');
      if (re.test(q)) {
        score += 3;
      }
    }
    for (const re of regexes) {
      if (re.test(q)) {
        score += 10;
      }
    }
    return score;
  }

  // Pre-calculate intent scores
  const scores = {
    // 1. Identity & capabilities
    bot_identity: scoreIntent(
      ['who are you', 'what are you', 'what can you do', 'how do you work', 'are you human', 'are you ai', 'vaultbot'],
      ['vaultbot', 'bot', 'assistant'],
      [/who (are|is) (you|vaultbot)/i, /what can you do/i]
    ),

    // 2. Greetings
    greeting: scoreIntent(
      ['good morning', 'good afternoon', 'good evening', 'greetings', 'what\'s up', 'how are you'],
      ['hello', 'hi', 'hey', 'sup', 'morning', 'afternoon', 'evening'],
      [/^(hi|hello|hey|greetings|morning)[\s!.]*$/i]
    ),

    // 3. Balance difference (Available vs Ledger)
    balance_difference: scoreIntent(
      ['difference between available', 'available vs ledger', 'why is my ledger', 'why ledger balance', 'ledger vs available', 'unposted balance', 'unposted funds', 'uncleared funds'],
      ['difference', 'versus'],
      [/available (and|vs|versus) ledger/i, /why is my ledger/i]
    ),

    // 4. Account balance & funds
    balance: scoreIntent(
      ['how much money', 'account balance', 'available balance', 'my balance', 'check balance', 'available funds', 'my funds', 'net worth', 'total balance', 'savings balance', 'bonus balance'],
      ['balance', 'funds', 'savings', 'bonus'],
      [/what('s| is) my balance/i, /how much (do i have|money|funds)/i]
    ),

    // 5. Account Details & Number
    account_details: scoreIntent(
      ['account number', 'what is my account number', 'my account number', 'account type', 'account tier', 'account status', 'account profile', 'my iban', 'my account id'],
      ['account'],
      [/what('s| is) my account (number|details|type)/i, /my account number/i]
    ),

    // 6. Recent Transactions & Statement
    transactions: scoreIntent(
      ['last transaction', 'recent transaction', 'recent transfer', 'did my transfer go through', 'transaction history', 'my debits', 'recent payments', 'show transactions', 'payment history'],
      ['transaction', 'transactions', 'debit', 'credit', 'payment'],
      [/what was my (last|recent) transaction/i, /did my (wire|transfer|payment) go through/i]
    ),

    // 7. Statements & PDF proof of funds
    statements_pdf: scoreIntent(
      ['download statement', 'pdf statement', 'bank statement', 'statement of account', 'proof of funds', 'official statement', 'bank certificate', 'account statement'],
      ['statement', 'pdf'],
      [/download (my )?(bank )?statement/i, /proof of funds/i]
    ),

    // 8. SWIFT, BIC, Routing, Bank Coordinates
    swift_routing: scoreIntent(
      ['swift code', 'bic code', 'routing number', 'routing code', 'aba number', 'bank coordinates', 'sort code', 'wire details', 'inward wire instructions', 'bank routing'],
      ['swift', 'bic', 'routing', 'iban'],
      [/what('s| is) (the|your) (swift|routing|bic) (code|number)/i]
    ),

    // 9. COT Code
    cot_code: scoreIntent(
      ['cot code', 'cost of transfer', 'my cot code', 'what is cot', 'cot clearance', 'cot hold'],
      ['cot'],
      [/what('s| is) (my|a) cot (code)?/i, /cost of transfer/i]
    ),

    // 10. IMF Code
    imf_code: scoreIntent(
      ['imf code', 'international monetary fund code', 'my imf code', 'what is imf', 'imf clearance', 'monetary fund code'],
      ['imf'],
      [/what('s| is) (my|an) imf (code)?/i, /international monetary fund/i]
    ),

    // 11. Tax Clearance Code
    tax_code: scoreIntent(
      ['tax code', 'tax clearance code', 'tax certificate', 'my tax code', 'what is tax code', 'withholding tax code', 'tcc code'],
      ['tcc'],
      [/what('s| is) (my|a) tax (clearance )?code/i]
    ),

    // 12. All Clearance Codes combined
    clearance_codes: scoreIntent(
      ['clearance codes', 'authorization codes', 'transfer codes', 'wire codes', 'clearance hold', 'why clearance code', 'what are my codes'],
      ['clearance', 'codes'],
      [/what are my (clearance|authorization) codes/i, /why do i need (a )?clearance/i]
    ),

    // 13. Transfer Speed & Fees
    transfer_fees_speed: scoreIntent(
      ['transfer fee', 'wire fee', 'transfer fees', 'wire fees', 'how long does transfer take', 'transfer cost', 'wire cost', 'international wire fee', 'wire speed', 'transfer limit', 'what is the fee', 'how long does a wire take', 'how long does a transfer take', 'how long does an international swift wire take'],
      ['fees', 'fee', 'cost', 'latency', 'duration', 'speed'],
      [/how long.*(transfer|wire)/i, /what (is|are) (the )?(fee|fees|cost)/i, /(fee|cost).*(transfer|wire)/i, /(transfer|wire).*(fee|cost)/i]
    ),

    // 14. Transfer How-To
    transfer: scoreIntent(
      ['how to send money', 'make a transfer', 'transfer funds', 'send wire', 'pay someone', 'outward transfer', 'wire instructions', 'send money abroad', 'wire money', 'internal transfer'],
      ['transfer', 'wire', 'remit', 'remittance'],
      [/how (do|can) i (send|transfer|wire) money/i, /make a (wire|transfer)/i]
    ),

    // 15. Transfer Pending / On Hold
    transfer_hold: scoreIntent(
      ['transfer pending', 'wire on hold', 'why is my transfer pending', 'transaction pending', 'wire held', 'clearance hold', 'transfer blocked', 'money stuck'],
      ['pending', 'held', 'stuck', 'blocked'],
      [/why is my (wire|transfer|payment) (pending|on hold|held)/i]
    ),

    // 16. Deposits & Inward Funding
    deposits: scoreIntent(
      ['how to deposit', 'add money', 'fund account', 'fund my account', 'check deposit', 'inward wire', 'mobile deposit', 'deposit methods', 'deposit slip', 'pay money in'],
      ['deposit', 'deposits'],
      [/how (do|can) i (deposit|fund|add) (money|funds)/i, /check deposit/i]
    ),

    // 17. Deposit Clearance & Timelines
    deposit_clearance: scoreIntent(
      ['deposit pending', 'deposit clearing time', 'how long for deposit to clear', 'check clearance timeline', 'when will deposit clear'],
      [],
      [/how long (does|will) (a )?deposit take to clear/i, /when will my deposit clear/i]
    ),

    // 18. Withdrawals & Payouts
    withdrawals: scoreIntent(
      ['how to withdraw', 'withdrawal request', 'payout', 'cash out', 'external wire payout', 'bank draft', 'take out money', 'withdraw funds'],
      ['withdraw', 'withdrawal', 'payout'],
      [/how (do|can) i withdraw/i, /request a payout/i]
    ),

    // 19. Payment Cards (Metal / Virtual)
    cards: scoreIntent(
      ['debit card', 'vault black', 'metal card', 'virtual card', 'platinum card', 'gold card', 'request card', 'card limit', 'apply for card', 'order card'],
      ['card', 'cards', 'metal'],
      [/how (do|can) i (get|request|order) a card/i, /black (metal )?card/i]
    ),

    // 20. Card Security & Freeze
    card_security: scoreIntent(
      ['freeze card', 'unfreeze card', 'lock card', 'block card', 'stolen card', 'lost card', 'view cvv', 'reveal pin', 'card pin', 'card stolen'],
      ['freeze', 'unfreeze', 'cvv'],
      [/(freeze|unfreeze|lock|block) my card/i, /card (stolen|lost)/i]
    ),

    // 21. Loans, Mortgages & Financing
    loans: scoreIntent(
      ['apply for loan', 'borrow money', 'mortgage', 'car loan', 'auto loan', 'interest rate', 'apr', 'commercial loan', 'loan calculator', 'monthly payment', 'personal loan'],
      ['loan', 'loans', 'mortgage', 'borrow', 'apr'],
      [/how (do|can) i (apply for|get) a loan/i, /what are your (loan|mortgage) rates/i]
    ),

    // 22. Grants & Capital Allocation
    grants: scoreIntent(
      ['enterprise grant', 'business grant', 'capital grant', 'non-repayable grant', 'apply for grant', 'endowment funding', 'government grant'],
      ['grant', 'grants', 'endowment'],
      [/apply for (a )?grant/i, /business grant/i]
    ),

    // 23. Tax Refund Claims Desk
    tax_refund: scoreIntent(
      ['tax refund', 'irs refund', 'refund claim', 'tax track', 'hmrc refund', 'tax refund stages', 'irs claim', 'tax return status'],
      ['refund', 'irs'],
      [/track (my )?tax refund/i, /claim (a )?tax refund/i]
    ),

    // 24. Investments & High-Yield Vaults
    investments: scoreIntent(
      ['investment plans', 'high yield vault', 'treasury vault', 'fixed yield', 'grow money', 'compound interest', 'investment earnings', 'sovereign wealth vault', 'invest money', 'apy'],
      ['invest', 'investment', 'investments', 'yield', 'apy', 'vaults'],
      [/what (are|is) (the )?investment plans/i, /how (does|do) (the )?treasury vaults work/i]
    ),

    // 25. Copy Trading & MT4 Signals
    trading: scoreIntent(
      ['copy trading', 'mt4', 'forex signals', 'trading signals', 'master trader', 'copy trade', 'automated trading', 'market signals', 'copy trade master'],
      ['trading', 'forex', 'signals'],
      [/how does copy trading work/i, /what are (the )?trading signals/i]
    ),

    // 26. Multi-Currency Wallets & FX
    wallets: scoreIntent(
      ['multi-currency', 'currency wallets', 'exchange rate', 'foreign exchange', 'fx swap', 'convert currency', 'convert money', 'usd to eur', 'eur to usd', 'gbp wallet'],
      ['wallet', 'wallets', 'currency', 'currencies', 'fx'],
      [/how (do|can) i (convert|swap) currency/i, /multi-currency wallets/i]
    ),

    // 27. Beneficiaries Directory
    beneficiaries: scoreIntent(
      ['add beneficiary', 'save beneficiary', 'save recipient', 'saved contacts', 'beneficiary directory', 'payee list', 'manage beneficiaries'],
      ['beneficiary', 'beneficiaries', 'payee'],
      [/how (do|can) i (add|save) a beneficiary/i]
    ),

    // 28. Security, 2FA & Password/PIN Rotation
    security: scoreIntent(
      ['account security', 'is my money safe', 'change password', 'change pin', 'reset pin', 'forgot pin', '2-tier authentication', 'two factor', 'encryption', 'fraud protection'],
      ['security', 'password', 'pin', '2fa', 'fraud'],
      [/how (do|can) i change (my )?(pin|password)/i, /is my (money|account) safe/i]
    ),

    // 29. Bank Identity, Location, Office, Licensing
    bank_identity: scoreIntent(
      ['about vaultatlantic', 'who is the bank', 'who is vaultatlantic', 'bank name', 'head office', 'headquarters', 'offices', 'where are your offices', 'where are you located', 'where is the bank', 'bank address', 'telephone number', 'opening hours', 'fca regulated', 'pra regulated', 'fscs protected', 'bank license'],
      ['headquarters', 'offices', 'office', 'license', 'regulated', 'hours'],
      [/where (are|is) (your|the) (headquarters|offices|office|head office|located)/i, /who is (the bank|vaultatlantic)/i]
    ),

    // 30. Admin Operations
    admin_operations: scoreIntent(
      ['admin portal', 'master admin', 'approve deposit', 'approve loan', 'adjust balance', 'resend email configuration', 'impersonate user', 'admin control'],
      ['admin'],
      [/how (does|do) (the )?admin/i]
    ),

    // 31. Human Support & Escalation
    escalation: scoreIntent(
      ['speak to human', 'talk to human', 'live agent', 'customer service agent', 'representative', 'operator', 'talk to someone', 'file complaint', 'support ticket', 'fraud dispute', 'human manager'],
      ['human', 'agent', 'representative', 'complaint', 'dispute'],
      [/(speak|talk) to (a )?(human|agent|person|representative)/i, /open a (support )?ticket/i]
    ),

    // 32. Appreciation & Farewell
    appreciation: scoreIntent(
      ['thank you', 'thanks a lot', 'goodbye', 'see you later', 'bye bye', 'great help', 'much appreciated'],
      ['thanks', 'bye', 'thx'],
      [/^(thank you|thanks|bye|goodbye)[\s!.]*$/i]
    )
  };

  // Find top scoring intent
  let bestIntent = null;
  let highestScore = 0;

  for (const [intentKey, score] of Object.entries(scores)) {
    if (score > highestScore) {
      highestScore = score;
      bestIntent = intentKey;
    }
  }

  // Threshold check: Must have at least score >= 3
  if (highestScore < 3) {
    bestIntent = 'fallback';
  }

  // ---------------------------------------------------------------------------
  // INTENT HANDLERS
  // ---------------------------------------------------------------------------

  switch (bestIntent) {
    case 'bot_identity':
      return {
        reply: `### 🤖 VaultBot AI — Commercial Banking Concierge\n\n` +
               `I am **VaultBot AI**, the 24/7 institutional financial assistant and concierge for **${settings.site_name}**.\n\n` +
               `**Core Capabilities:**\n` +
               `• **Real-Time Ledgers:** Instant balances, breakdown of available vs. ledger vs. high-yield savings.\n` +
               `• **Wire & Payments:** Domestic ACH, zero-fee internal transfers, and international SWIFT routing.\n` +
               `• **Statutory Clearance Tokens:** Provide and explain your **COT**, **IMF**, and **Tax Clearance** codes.\n` +
               `• **Payment Cards:** Instant virtual cards, Solid Metal cards, CVV viewing, and emergency 1-click freezes.\n` +
               `• **Institutional Wealth:** Treasury vaults with up to 32% APY, commercial financing, and business grants.\n` +
               `• **Human Escalation:** Immediate connection to compliance officers and 24/7 support.\n\n` +
               `How may I assist you today, ${firstName}?`,
        category: 'IDENTITY',
        suggestedActions: [
          { label: 'Check Balance', link: '/e-banking/overview' },
          { label: 'Transfer Desk', link: '/e-banking/fund-transfer' },
          { label: 'Manage Cards', link: '/e-banking/cards' },
          { label: 'Support Desk', link: '/e-banking/support' }
        ],
        canEscalateToHuman: false
      };

    case 'greeting': {
      const hour = new Date().getHours();
      const timeGreeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
      return {
        reply: `${timeGreeting}, ${firstName}! Welcome to **${settings.site_name}**.\n\n` +
               `I am **VaultBot AI**, your dedicated financial concierge. How may I assist you with your accounts, transfers, payment cards, or wire clearances today?`,
        category: 'GREETING',
        suggestedActions: [
          { label: 'Account Balance', link: '/e-banking/overview' },
          { label: 'Send Wire', link: '/e-banking/fund-transfer' },
          { label: 'Inward Routing', link: '/e-banking/deposit' }
        ],
        canEscalateToHuman: false
      };
    }

    case 'balance_difference':
      return {
        reply: `### 📊 Available Balance vs. Ledger Balance Explained\n\n` +
               `• **Available Balance (${formatMoney(user.available_balance, currency)}):**\n` +
               `These are liquid, cleared funds immediately spendable for card purchases, outward wire transfers, and withdrawals. It represents posted deposits minus active pending authorizations or pre-clearing holds.\n\n` +
               `• **Ledger Balance (${formatMoney(user.ledger_balance, currency)}):**\n` +
               `The book balance calculated at the close of the preceding clearing cycle. This includes unposted clearinghouse batches, provisional check deposit credits under Reg CC, and unsettled outward settlement holds.\n\n` +
               `Reconciliation occurs automatically upon Federal Reserve or BACS batch finality (typically within 2 to 24 hours).`,
        category: 'BALANCE',
        suggestedActions: [
          { label: 'View Account Statement', link: '/e-banking/statement' },
          { label: 'Deposit Funds', link: '/e-banking/deposit' }
        ],
        canEscalateToHuman: false
      };

    case 'balance':
      return {
        reply: `### 💼 Financial Ledger Summary for ${firstName}\n\n` +
               `• **Available Balance:** **${formatMoney(user.available_balance, currency)}** *(Liquid & Active)*\n` +
               `• **Total Ledger Balance:** ${formatMoney(user.ledger_balance, currency)}\n` +
               `• **High-Yield Savings:** ${formatMoney(user.savings_balance, currency)}\n` +
               `• **Promotional Bonus Ledger:** ${formatMoney(user.bonus_balance, currency)}\n` +
               `• **Accrued Investment Dividends:** ${formatMoney(user.investment_earnings, currency)}\n\n` +
               `**Account Particulars:**\n` +
               `• Primary Account Number: **#${user.account_number || 'Pending'}**\n` +
               `• Classification: **${user.account_type || 'Commercial Checking'}**\n` +
               `• Operational Status: **${user.status || 'ACTIVE'}** (KYC: ${user.kyc_status || 'VERIFIED'})`,
        category: 'BALANCE',
        suggestedActions: [
          { label: 'View Full Statement', link: '/e-banking/statement' },
          { label: 'Send Funds Wire', link: '/e-banking/fund-transfer' },
          { label: 'Deposit Funds', link: '/e-banking/deposit' }
        ],
        canEscalateToHuman: false
      };

    case 'account_details':
      return {
        reply: `### 📑 Primary Account Particulars\n\n` +
               `• **Account Holder:** **${fullName}**\n` +
               `• **Account Number:** **\`#${user.account_number || 'Pending Provision'}\`**\n` +
               `• **Account Classification:** **${user.account_type || 'Commercial Checking'}**\n` +
               `• **Primary Currency:** **${currency}**\n` +
               `• **KYC Compliance Status:** **${user.kyc_status || 'VERIFIED'}**\n` +
               `• **Account State:** **${user.status || 'ACTIVE'}**\n` +
               `• **SWIFT / BIC Code:** **\`${settings.swift_code}\`**\n` +
               `• **ABA Domestic Routing:** **\`${settings.routing_number}\`**\n` +
               `• **Registered Email:** ${user.email || 'N/A'}\n\n` +
               `Your account is fully accredited and covered under international banking deposit insurance.`,
        category: 'ACCOUNT_DETAILS',
        suggestedActions: [
          { label: 'View Dashboard Overview', link: '/e-banking/overview' },
          { label: 'Account Statement', link: '/e-banking/statement' },
          { label: 'Security & PIN Settings', link: '/e-banking/settings' }
        ],
        canEscalateToHuman: false
      };

    case 'transactions': {
      let txInfo = '';
      if (recentTx) {
        txInfo = `### 📋 Most Recent Account Transaction\n\n` +
                 `• **Reference:** \`${recentTx.reference_number}\`\n` +
                 `• **Type & Rail:** **${recentTx.transaction_type}** (${recentTx.channel.replace(/_/g, ' ')})\n` +
                 `• **Amount:** **${formatMoney(recentTx.amount, recentTx.currency || currency)}**\n` +
                 `• **Counterparty:** ${recentTx.counterparty_name || 'N/A'} (${recentTx.counterparty_bank || settings.site_name})\n` +
                 `• **Posting Date:** ${formatDate(recentTx.post_date)}\n` +
                 `• **Settlement Status:** **${recentTx.status}**\n` +
                 `• **Narration:** *"${recentTx.narration || 'Funds transfer'}"*\n\n`;
      } else {
        txInfo = `You currently have no settled transactions on record. Any posted debits or credits will automatically appear here.\n\n`;
      }
      return {
        reply: txInfo + `You can audit your complete transaction history, apply custom date filters, or download verified statements from the Statements desk.`,
        category: 'TRANSACTIONS',
        suggestedActions: [
          { label: 'View Statement History', link: '/e-banking/statement' },
          { label: 'Download PDF Statement', link: '/e-banking/statement' },
          { label: 'Transfer Desk', link: '/e-banking/fund-transfer' }
        ],
        canEscalateToHuman: false
      };
    }

    case 'statements_pdf':
      return {
        reply: `### 📄 Official Bank Statements & Proof of Funds\n\n` +
               `You can generate certified, digitally stamped PDF bank statements directly from your account:\n\n` +
               `• **Accredited Format:** Features official bank header, corporate seal, cryptographic document hash, and QR verification.\n` +
               `• **Flexible Filtering:** Export by custom date intervals (Last 30 Days, 90 Days, Year-to-Date, or Custom Range).\n` +
               `• **Official Proof of Funds:** Suitable for visa applications, mortgage underwriters, regulatory authorities, and commercial auditors.\n\n` +
               `To export your document, navigate to [Account Statements](/e-banking/statement) and click **"Download Official PDF"**.`,
        category: 'STATEMENTS',
        suggestedActions: [
          { label: 'Export PDF Statement', link: '/e-banking/statement' },
          { label: 'Account Overview', link: '/e-banking/overview' }
        ],
        canEscalateToHuman: false
      };

    case 'swift_routing':
      return {
        reply: `### 🌐 Official Institutional Banking Coordinates\n\n` +
               `Use these verified credentials for incoming domestic ACH, Fedwire, and international SWIFT remittances:\n\n` +
               `• **Institution Name:** **${settings.site_name}**\n` +
               `• **SWIFT / BIC Code:** **\`${settings.swift_code}\`**\n` +
               `• **ABA / Domestic Routing Number:** **\`${settings.routing_number}\`**\n` +
               `• **Beneficiary Name:** ${fullName}\n` +
               `• **Beneficiary Account Number:** **\`${user.account_number || 'Pending'}\`**\n` +
               `• **Global Head Office:** ${settings.address}\n` +
               `• **Treasury Direct Wire Phone:** ${settings.phone_number}\n` +
               `• **Wire Settlement Support:** ${settings.contact_email}\n\n` +
               `**Typical Clearing Windows:**\n` +
               `• Domestic ACH: 1 to 2 business days\n` +
               `• International SWIFT Wire: 24 to 48 business hours with direct available balance crediting.`,
        category: 'SWIFT_ROUTING',
        suggestedActions: [
          { label: 'Inward Wire Instructions', link: '/e-banking/deposit' },
          { label: 'Send Outward Wire', link: '/e-banking/fund-transfer' }
        ],
        canEscalateToHuman: false
      };

    case 'cot_code':
      return {
        reply: `### 🔐 Cost of Transfer (COT) Code\n\n` +
               `Your account's assigned COT Code is: **\`${user.cot_code || 'COT-7749'}\`**\n\n` +
               `**Regulatory Definition & Purpose:**\n` +
               `The **Cost of Transfer (COT)** code is an anti-money laundering and statutory settlement credential required by international commercial banking regulations. It authenticates outward high-value wire transfers and guarantees that transaction tariffs are fully reconciled before ledger finality.\n\n` +
               `• **Status:** Active & Verified\n` +
               `• **Usage:** Enter this code when prompted during international wire dispatches. If you encounter any clearance hold, our treasury desk can assist.`,
        category: 'CLEARANCE_CODES',
        suggestedActions: [
          { label: 'Proceed to Transfer Desk', link: '/e-banking/fund-transfer' },
          { label: 'Contact Support Desk', link: '/e-banking/support' }
        ],
        canEscalateToHuman: false
      };

    case 'imf_code':
      return {
        reply: `### 🌐 International Monetary Fund (IMF) Clearance Code\n\n` +
               `Your account's registered IMF Clearance Code is: **\`${user.imf_code || 'IMF-9904'}\`**\n\n` +
               `**Regulatory Definition & Purpose:**\n` +
               `The **IMF Clearance Certificate Code** satisfies cross-border liquidity validation standards established under international anti-terrorist financing conventions. It verifies that offshore wire disbursements adhere to bilateral foreign exchange reserves without illicit capital flight.\n\n` +
               `• **Status:** Active & Authorized\n` +
               `• **Application:** Required during Tier-2 international SWIFT settlements and institutional transfers.`,
        category: 'CLEARANCE_CODES',
        suggestedActions: [
          { label: 'Open Transfer Desk', link: '/e-banking/fund-transfer' },
          { label: 'Consult Compliance Officer', link: '/e-banking/support' }
        ],
        canEscalateToHuman: false
      };

    case 'tax_code':
      return {
        reply: `### 🏛️ Tax Clearance Certificate (TCC) Code\n\n` +
               `Your active Tax Clearance Code is: **\`${user.tax_code || 'TAX-8821'}\`**\n\n` +
               `**Regulatory Definition & Purpose:**\n` +
               `The **Tax Clearance Code** certifies that all applicable statutory withholding taxes and capital remittance levies have been indemnified with sovereign fiscal revenue authorities prior to cross-border capital release.\n\n` +
               `• **Status:** Validated\n` +
               `• **Applicability:** Outward corporate dividends, institutional disbursements, and international wire finality.`,
        category: 'CLEARANCE_CODES',
        suggestedActions: [
          { label: 'Track Tax Refund Desk', link: '/e-banking/tax-refund' },
          { label: 'Transfer Desk', link: '/e-banking/fund-transfer' }
        ],
        canEscalateToHuman: false
      };

    case 'clearance_codes':
      return {
        reply: `### 🔐 VaultAtlantic Clearance & Authorization Protocols\n\n` +
               `For your account (**#${user.account_number || '026009593'}**), the following regulatory clearance tokens are active:\n\n` +
               `| Clearance Token | Code Reference | Purpose |\n` +
               `| :--- | :--- | :--- |\n` +
               `| **COT Code** | **\`${user.cot_code || 'COT-7749'}\`** | Cost of Transfer statutory settlement authorization |\n` +
               `| **IMF Code** | **\`${user.imf_code || 'IMF-9904'}\`** | International Monetary Fund cross-border compliance |\n` +
               `| **Tax Code** | **\`${user.tax_code || 'TAX-8821'}\`** | Sovereign withholding tax clearance token |\n\n` +
               `**Why are these codes required?**\n` +
               `Under global AML (Anti-Money Laundering) and FATF (Financial Action Task Force) frameworks, high-volume and cross-border disbursements mandate dual-key cryptographic validation to safeguard institutional accounts against unauthorized capital flight.`,
        category: 'CLEARANCE_CODES',
        suggestedActions: [
          { label: 'Send Wire Transfer', link: '/e-banking/fund-transfer' },
          { label: 'Support Desk Assistance', link: '/e-banking/support' }
        ],
        canEscalateToHuman: true
      };

    case 'transfer_fees_speed':
      return {
        reply: `### ⚡ VaultAtlantic Wire & Transfer Schedule\n\n` +
               `| Transfer Channel | Settlement Latency | Transfer Fee | Daily Limit |\n` +
               `| :--- | :--- | :--- | :--- |\n` +
               `| **Internal Transfer** *(Vault-to-Vault)* | **Instantaneous (0 sec)** | **$0.00 (Free)** | Unlimited |\n` +
               `| **Domestic Transfer (ACH / Fedwire)** | **1 to 2 business days** | **$5.00** | $250,000 / day |\n` +
               `| **International SWIFT Wire** | **24 to 48 business hours** | **$25.00** | $1,000,000 / day |\n\n` +
               `**Key Features:**\n` +
               `• Dual-factor 4-digit PIN verification protects every transfer.\n` +
               `• Real-time automated Resend email debit alerts sent to **${user.email || 'your inbox'}**.\n` +
               `• Certified audit tracking reference generated immediately upon dispatch.`,
        category: 'TRANSFERS',
        suggestedActions: [
          { label: 'Initiate Transfer Now', link: '/e-banking/fund-transfer' },
          { label: 'Manage Beneficiaries', link: '/e-banking/beneficiaries' }
        ],
        canEscalateToHuman: false
      };

    case 'transfer':
      return {
        reply: `### 💸 Outward Funds Transfer Protocol\n\n` +
               `You can send domestic ACH, international SWIFT wires, or instant zero-fee internal transfers through your **Transfer Desk**.\n\n` +
               `**Step-by-Step Instructions:**\n` +
               `1. Open the [Transfer Desk](/e-banking/fund-transfer).\n` +
               `2. Select your transfer channel: **Local**, **Domestic**, or **International Wire**.\n` +
               `3. Enter the receiver's name, bank name, account/IBAN number, and SWIFT/Routing code.\n` +
               `4. Input the desired amount (Your available balance: **${formatMoney(user.available_balance, currency)}**).\n` +
               `5. Authorize the transaction using your secret **4-Digit Transaction PIN**.\n\n` +
               `*Note: Cross-border wires may prompt for your COT or IMF clearance authorization tokens.*`,
        category: 'TRANSFERS',
        suggestedActions: [
          { label: 'Open Transfer Desk', link: '/e-banking/fund-transfer' },
          { label: 'Saved Beneficiaries', link: '/e-banking/beneficiaries' },
          { label: 'Multi-Currency Wallets', link: '/e-banking/wallets' }
        ],
        canEscalateToHuman: false
      };

    case 'transfer_hold':
      return {
        reply: `### ⚠️ Transfer Hold & Clearance Verification Protocol\n\n` +
               `If an outward wire transfer is marked as **PENDING** or placed on temporary clearance hold, it typically reflects one of the following compliance checks:\n\n` +
               `1. **Statutory Clearance Token Required:** The receiving intermediary bank mandates submission of your **COT**, **IMF**, or **Tax Clearance** code.\n` +
               `2. **Correspondent Intermediary Clearing:** Outward SWIFT wires transit through Fedwire or CHIPS correspondent banks across 24 to 48 business hours.\n` +
               `3. **AML / Large Exposure Review:** Transactions exceeding $50,000 undergo routine fraud detection audit.\n\n` +
               `To expedite clearance, you may submit a priority ticket directly to our compliance officer.`,
        category: 'TRANSFERS',
        suggestedActions: [
          { label: 'Open Priority Ticket', link: '/e-banking/support' },
          { label: 'Review Clearance Codes', link: '/e-banking/fund-transfer' }
        ],
        canEscalateToHuman: true
      };

    case 'deposits':
      return {
        reply: `### 📥 Inward Capital Settlement & Deposit Channels\n\n` +
               `To deposit funds into your **${settings.site_name}** account, navigate to the [Deposit Module](/e-banking/deposit).\n\n` +
               `**Available Inflow Channels:**\n` +
               `1. **Bank Wire Inward:** Wire funds from any external bank using SWIFT **\`${settings.swift_code}\`** and your account **\`#${user.account_number || '026009593'}\`**.\n` +
               `2. **Certified Mobile Check Scanning:** Upload high-resolution front and back photos of endorsed checks for automated optical OCR verification.\n` +
               `3. **Direct ACH Inflow:** Set up recurring payroll or vendor direct deposits with routing number **\`${settings.routing_number}\`**.\n\n` +
               `**Clearing Timelines:**\n` +
               `• Electronic Wires: Cleared within **2 to 6 business hours** after treasury verification.\n` +
               `• Certified Check Scans: Cleared within **24 to 48 business hours** in compliance with Reg CC availability schedules. Zero deposit processing fees.`,
        category: 'DEPOSITS',
        suggestedActions: [
          { label: 'Submit Deposit Request', link: '/e-banking/deposit' },
          { label: 'View SWIFT Coordinates', link: '/e-banking/deposit' }
        ],
        canEscalateToHuman: false
      };

    case 'deposit_clearance':
      return {
        reply: `### ⏱️ Deposit Clearing & Verification Windows\n\n` +
               `• **Bank Wire Inflows:** Verified and credited within **2 to 6 business hours** of treasury receipt.\n` +
               `• **Mobile Check Scans:** Processed under Federal Reserve Regulation CC schedules within **24 to 48 business hours** following optical character recognition (OCR) and maker institution clearance.\n` +
               `• **ACH Direct Credits:** Settle by 9:00 AM EST on the scheduled effective deposit date.\n\n` +
               `Once approved by the treasury desk, funds immediately reflect in your available balance with an email confirmation sent to your inbox.`,
        category: 'DEPOSITS',
        suggestedActions: [
          { label: 'Check Deposit Status', link: '/e-banking/statement' },
          { label: 'New Deposit Request', link: '/e-banking/deposit' }
        ],
        canEscalateToHuman: false
      };

    case 'withdrawals':
      return {
        reply: `### 📤 Capital Withdrawal & Payout Protocol\n\n` +
               `To withdraw funds from your VaultAtlantic account to an external bank or receive an institutional bank draft:\n\n` +
               `1. Visit the [Withdrawal Portal](/e-banking/withdrawals).\n` +
               `2. Enter the amount to disburse (Max available: **${formatMoney(user.available_balance, currency)}**).\n` +
               `3. Provide your external receiving bank account details and routing coordinates.\n` +
               `4. Confirm the withdrawal with your 4-digit Transaction PIN.\n\n` +
               `**Compliance Review:**\n` +
               `All outward withdrawals are audited by our treasury compliance team within **1 to 24 business hours** to verify identity safeguards and prevent unauthorized capital drain.`,
        category: 'WITHDRAWALS',
        suggestedActions: [
          { label: 'Request Withdrawal', link: '/e-banking/withdrawals' },
          { label: 'Check Balance', link: '/e-banking/overview' }
        ],
        canEscalateToHuman: false
      };

    case 'cards':
      return {
        reply: `### 💳 Payment Card Management Hub\n\n` +
               `You currently have **${cardCount} active card(s)** linked to your account.\n\n` +
               `**Available Card Tiers:**\n` +
               `• **Solid Metal Sovereign "Vault Black":** Up to $100,000 monthly limit, zero foreign transaction fees, contactless EMV, exclusive airport lounge concierge.\n` +
               `• **Corporate Platinum:** Up to $50,000 monthly limit with corporate expense categorization.\n` +
               `• **Gold Prestige:** $25,000 monthly spending limit with 1.5% cashback on retail transactions.\n` +
               `• **Instant Virtual Cards:** Generated immediately for secure online purchases with masked tokenized credentials.\n\n` +
               `You can request new cards, view full 16-digit PANs and CVVs, or toggle instant freeze from your Cards Hub.`,
        category: 'CARDS',
        suggestedActions: [
          { label: 'Open Cards Hub', link: '/e-banking/cards' },
          { label: 'Request New Card', link: '/e-banking/cards' }
        ],
        canEscalateToHuman: false
      };

    case 'card_security':
      return {
        reply: `### 🛡️ Real-Time Card Security & Emergency Lock\n\n` +
               `You can freeze or unfreeze any of your active cards with **instant effect**:\n\n` +
               `1. Open the [Cards Hub](/e-banking/cards).\n` +
               `2. Locate your card and toggle the **"Freeze Card"** switch.\n` +
               `3. Once frozen, all POS transactions, online merchant charges, and ATM withdrawals will be rejected instantly.\n\n` +
               `If you suspect your physical card is compromised or stolen, toggle the freeze immediately and contact our 24/7 fraud desk to issue an instant replacement virtual card.`,
        category: 'CARDS',
        suggestedActions: [
          { label: 'Manage Payment Cards', link: '/e-banking/cards' },
          { label: 'Contact Support Desk', link: '/e-banking/support' }
        ],
        canEscalateToHuman: true
      };

    case 'loans':
      return {
        reply: `### 🏦 Credit Facilities & Commercial Financing\n\n` +
               `**${settings.site_name}** provides institutional credit facilities tailored to commercial expansion and private wealth requirements:\n\n` +
               `• **Personal Liquidity Facilities:** Fixed APR starting at **5.20%**, terms from 12 to 60 months.\n` +
               `• **Commercial & Working Capital:** Fixed APR starting at **4.80%**, flexible repayment amortizations.\n` +
               `• **Real Estate Mortgages:** Competitive rates starting at **3.90% APR**, terms from 5 to 30 years.\n` +
               `• **Auto & Asset Financing:** Fixed APR starting at **4.50%**.\n\n` +
               `**Application Process:**\n` +
               `You currently have **${loanCount} active loan(s)**. You can simulate monthly repayment schedules or submit an application with automated credit evaluation through the Loans portal. Approved funds are disbursed directly into your available balance.`,
        category: 'LOANS',
        suggestedActions: [
          { label: 'Apply for a Loan', link: '/e-banking/loans' },
          { label: 'Loan Calculator', link: '/calculator' }
        ],
        canEscalateToHuman: false
      };

    case 'grants':
      return {
        reply: `### 🎓 Institutional Enterprise Grants Program\n\n` +
               `VaultAtlantic collaborates with sovereign development endowments and institutional venture funds to provide **non-repayable capital grants**:\n\n` +
               `• **Grant Allocation Range:** $10,000 to $500,000 USD.\n` +
               `• **Eligible Categories:** Green technology, healthcare innovation, supply chain modernization, and small business digital transformation.\n` +
               `• **Key Advantage:** Non-dilutive, zero-interest, and zero-repayment obligations upon fulfillment of project milestones.\n\n` +
               `Submit your executive proposal, projected impact, and budget breakdown through the Grant Application desk. Applications are audited within 5 business days.`,
        category: 'GRANTS',
        suggestedActions: [
          { label: 'Apply for Enterprise Grant', link: '/e-banking/grants' },
          { label: 'Support Desk', link: '/e-banking/support' }
        ],
        canEscalateToHuman: false
      };

    case 'tax_refund':
      return {
        reply: `### 🏛️ Tax Refund Claim & IRS Tracker Desk\n\n` +
               `VaultAtlantic's Tax Refund Clearing Desk connects directly with treasury revenue services to expedite institutional and personal tax refunds.\n\n` +
               `**4-Phase Verification Pipeline:**\n` +
               `1. **Phase 1: Claim Transmitted:** Tax documents and claim numbers securely cataloged.\n` +
               `2. **Phase 2: IRS / Revenue Authority Audited:** Bilateral confirmation of eligibility and tax withholding credits.\n` +
               `3. **Phase 3: Treasury Approval:** Direct electronic settlement allocation issued to VaultAtlantic.\n` +
               `4. **Phase 4: Checking Account Disbursal:** Funds credited directly to your liquid balance.\n\n` +
               `Track real-time progress or submit a new refund filing under the Tax Refund module.`,
        category: 'TAX_REFUND',
        suggestedActions: [
          { label: 'Track Tax Refund Status', link: '/e-banking/tax-refund' },
          { label: 'View Account Statement', link: '/e-banking/statement' }
        ],
        canEscalateToHuman: false
      };

    case 'investments':
      return {
        reply: `### 📈 Sovereign High-Yield Treasury Vaults\n\n` +
               `Lock in institutional fixed APY yields guaranteed against statutory bank reserve capital:\n\n` +
               `• **Starter Treasury Vault:** **8.00% APY** | 30-Day Term | Min $500\n` +
               `• **Growth Portfolio Tier:** **14.00% APY** | 90-Day Term | Min $2,500\n` +
               `• **Sovereign Wealth Vault:** **22.00% APY** | 180-Day Term | Min $10,000\n` +
               `• **Institutional Capital Reserve:** **32.00% APY** | 365-Day Term | Min $50,000\n\n` +
               `**Yield Mechanics:**\n` +
               `Dividends accrue daily and post into your **Investment Earnings** ledger (Current accrued: **${formatMoney(user.investment_earnings, currency)}**). At maturity, the principal and interest sweep automatically to your primary liquid balance.`,
        category: 'INVESTMENTS',
        suggestedActions: [
          { label: 'Explore Investment Vaults', link: '/e-banking/investments' },
          { label: 'Account Overview', link: '/e-banking/overview' }
        ],
        canEscalateToHuman: false
      };

    case 'trading':
      return {
        reply: `### 📊 MT4 Algorithmic Copy Trading & Market Signals\n\n` +
               `Replicate verified institutional portfolio managers in real time with zero manual intervention:\n\n` +
               `• **Master Trader Audits:** All signal providers must maintain a minimum 12-month track record with verified Sharpe ratios and under 15% maximum drawdown.\n` +
               `• **Proportional Allocation:** Positions are copied proportionally to your balance with automated stop-loss protection.\n` +
               `• **Real-Time Execution:** Low-latency API connectivity ensures trades execute with negligible slippage.\n\n` +
               `Review verified master profiles, win rates, and active signals on the Copy Trading Desk.`,
        category: 'TRADING',
        suggestedActions: [
          { label: 'Open Copy Trading Desk', link: '/e-banking/trading' },
          { label: 'Financial Academy', link: '/e-banking/academy' }
        ],
        canEscalateToHuman: false
      };

    case 'wallets':
      return {
        reply: `### 💱 Multi-Currency Sub-Ledgers & Global FX\n\n` +
               `**${settings.site_name}** provides institutional multi-currency capabilities with real-time interbank conversion rates:\n\n` +
               `• **Supported Currencies:** **USD ($)**, **EUR (€)**, **GBP (£)**, and **NGN (₦)**.\n` +
               `• **Interbank Pricing:** Near-zero spread conversion rates based on institutional market benchmarks.\n` +
               `• **Instant Conversions:** Swap funds seamlessly between foreign currency sub-wallets with immediate settlement.\n` +
               `• **Direct Local Inflow:** Receive international transfers natively in euros, pounds, or dollars without unwanted forced conversion.`,
        category: 'WALLETS',
        suggestedActions: [
          { label: 'Multi-Currency Wallets', link: '/e-banking/wallets' },
          { label: 'Transfer Desk', link: '/e-banking/fund-transfer' }
        ],
        canEscalateToHuman: false
      };

    case 'beneficiaries':
      return {
        reply: `### 👥 Beneficiary Directory & Fast Remittance\n\n` +
               `You can save frequent external payees to your **Beneficiary Directory** to execute recurring domestic or international wire transfers without manually entering account and routing numbers each time:\n\n` +
               `• Add new beneficiaries with validated bank name, account number, and SWIFT/Routing code.\n` +
               `• 1-Click transfer initiation from the saved contacts list.\n` +
               `• Delete or edit recipient information at any time.`,
        category: 'BENEFICIARIES',
        suggestedActions: [
          { label: 'Manage Beneficiaries', link: '/e-banking/beneficiaries' },
          { label: 'Send Wire Transfer', link: '/e-banking/fund-transfer' }
        ],
        canEscalateToHuman: false
      };

    case 'security':
      return {
        reply: `### 🛡️ Institutional Security & Vault Protection Architecture\n\n` +
               `**${settings.site_name}** operates under stringent military-grade commercial banking security standards:\n\n` +
               `1. **256-Bit AES & TLS 1.3 Encryption:** All database records, session cookies, and transit payloads are cryptographically ciphered.\n` +
               `2. **2-Tier Dual Credential Protection:** Sign-in requires your master password, while every transactional movement, withdrawal, or card unfreeze demands your secret **4-digit Transaction PIN**.\n` +
               `3. **Automated Anomaly Detection:** Continuous real-time IP, geolocation, and device fingerprint monitoring prevents unauthorized takeover.\n` +
               `4. **Instant Password & PIN Rotation:** You can update your master password and transaction PIN at any time under [Account Settings](/e-banking/settings).\n\n` +
               `*If you suspect unauthorized activity, contact our 24/7 security dispatch immediately.*`,
        category: 'SECURITY',
        suggestedActions: [
          { label: 'Security & PIN Settings', link: '/e-banking/settings' },
          { label: 'Support Desk Desk', link: '/e-banking/support' }
        ],
        canEscalateToHuman: true
      };

    case 'bank_identity':
      return {
        reply: `### 🏛️ About ${settings.site_name}\n\n` +
               `• **Legal Corporate Entity:** **${settings.site_name}**\n` +
               `• **Tagline:** *${settings.site_tagline}*\n` +
               `• **Global Headquarters:** ${settings.address}\n` +
               `• **SWIFT / BIC:** **\`${settings.swift_code}\`**\n` +
               `• **Domestic Routing:** **\`${settings.routing_number}\`**\n` +
               `• **Telephone Support:** ${settings.phone_number}\n` +
               `• **Official Inquiries:** ${settings.contact_email}\n` +
               `• **Hours of Operation:** **${settings.support_hours}**\n\n` +
               `**Regulatory & Deposit Insurance:**\n` +
               `Authorized and regulated under commercial banking authorities. Client deposits are held in segregated reserve custodial accounts with statutory deposit protection insurance under international prudential standards.`,
        category: 'ABOUT',
        suggestedActions: [
          { label: 'Account Overview', link: '/e-banking/overview' },
          { label: 'Contact Support Desk', link: '/e-banking/support' }
        ],
        canEscalateToHuman: false
      };

    case 'admin_operations':
      return {
        reply: `### ⚙️ Master Administrative Control Operations\n\n` +
               `Authorized administrators can execute institutional controls from the [Master Admin Portal](/admin/overview):\n\n` +
               `• **Deposit Approvals:** Audit incoming deposit slips, certified check images, and approve or reject ledger crediting.\n` +
               `• **Withdrawal Processing:** Authorize or decline outward wire payout requests.\n` +
               `• **Loan Review Center:** Evaluate commercial loan applications, debt-to-income scores, and approve disbursements.\n` +
               `• **Balance & Code Overrides:** Credit/debit user ledgers and assign customized **COT**, **IMF**, and **Tax Clearance** codes.\n` +
               `• **Resend Email Integration:** Send custom transactional broadcasts and verify API delivery status directly to user mailboxes.\n` +
               `• **Branding & System Setup:** Update website logos, bank name, phone numbers, and operational parameters from the Admin Setup Desk.`,
        category: 'ADMIN',
        suggestedActions: [
          { label: 'Open Admin Overview', link: '/admin/overview' },
          { label: 'Manage Users', link: '/admin/users' },
          { label: 'Deposits Queue', link: '/admin/deposits' }
        ],
        canEscalateToHuman: false
      };

    case 'escalation':
      return {
        reply: `### 👤 Direct Connection to Human Executive Support\n\n` +
               `I will be glad to connect you directly with a dedicated **VaultAtlantic Banking Officer**.\n\n` +
               `**Available Support Options:**\n` +
               `• **Open Support Ticket:** Submit a priority ticket directly to our compliance and treasury desk for formal resolution.\n` +
               `• **Telephone Desk:** Call **${settings.phone_number}** (${settings.support_hours}).\n` +
               `• **Direct Email:** Reach our executive operations desk at **${settings.contact_email}**.\n\n` +
               `Click the button below to open an expedited ticket with your inquiry pre-attached.`,
        category: 'ESCALATION',
        suggestedActions: [
          { label: 'Open Priority Support Ticket', link: '/e-banking/support' }
        ],
        canEscalateToHuman: true
      };

    case 'appreciation':
      return {
        reply: `You are very welcome, ${firstName}! It is my pleasure serving you.\n\n` +
               `If you have any further questions regarding your account, wire clearances, or investment vaults, I am here 24/7. Have a prosperous day with **${settings.site_name}**!`,
        category: 'COURTESY',
        suggestedActions: [
          { label: 'Account Overview', link: '/e-banking/overview' },
          { label: 'Transfer Desk', link: '/e-banking/fund-transfer' }
        ],
        canEscalateToHuman: false
      };

    default: // fallback
      return {
        reply: `Thank you for your inquiry, ${firstName}.\n\n` +
               `As your **VaultAtlantic Banking Assistant**, I can assist with both routine and complex institutional matters:\n\n` +
               `• **Account Inquiries:** Real-time balances, statement generation, and transaction history.\n` +
               `• **Wire Transfers:** Domestic ACH, zero-fee internal transfers, and international SWIFT coordinates (SWIFT: **\`${settings.swift_code}\`**).\n` +
               `• **Statutory Clearances:** View or explain your **COT**, **IMF**, and **Tax Clearance** codes.\n` +
               `• **Wealth & Cards:** Solid Metal cards, high-yield investment vaults (up to 32% APY), commercial loans, and enterprise grants.\n` +
               `• **Direct Support:** Connect immediately with our 24/7 compliance desk.\n\n` +
               `Could you please clarify your request, or choose one of the direct shortcuts below?`,
        category: 'GENERAL',
        suggestedActions: [
          { label: 'Check Account Balance', link: '/e-banking/overview' },
          { label: 'Send Wire Transfer', link: '/e-banking/fund-transfer' },
          { label: 'View Clearance Codes', link: '/e-banking/fund-transfer' },
          { label: 'Open Support Ticket', link: '/e-banking/support' }
        ],
        canEscalateToHuman: true
      };
  }
}

/**
 * Main Entry Point for VaultBot AI Assistant
 */
async function getChatbotResponse(userId, query) {
  // 1. Gather all live user & system data
  const ctx = await getChatbotContext(userId);

  // 2. Check if external LLM API is available and succeeds
  try {
    const llmResult = await callGenerativeLLM(query, ctx);
    if (llmResult) {
      return llmResult;
    }
  } catch (err) {
    console.warn('[VaultBot AI] LLM error, continuing with built-in engine:', err);
  }

  // 3. Run high-intelligence Built-in Banking Engine
  return processBuiltInQuery(query, ctx);
}

module.exports = {
  getChatbotResponse,
  getChatbotContext
};
