const { Resend } = require('resend');

// Initialize Resend Client
const apiKey = process.env.RESEND_API_KEY;
let resendClient = null;

if (apiKey && apiKey.trim().startsWith('re_')) {
  try {
    resendClient = new Resend(apiKey.trim());
    console.log('✅ [Resend] Email Client initialized with API key.');
  } catch (err) {
    console.warn('⚠️ [Resend] Failed to initialize client:', err.message);
  }
} else {
  console.log('ℹ️ [Resend] Running in simulation/fallback mode. Add a valid RESEND_API_KEY starting with "re_" in .env to dispatch live emails.');
}

const DEFAULT_FROM = process.env.RESEND_FROM_EMAIL || 'Obsidian Trust Bancorp <onboarding@resend.dev>';

/**
 * Base email dispatcher
 */
async function sendEmail({ to, subject, html, text, replyTo }) {
  try {
    // Refresh client in case process.env changed dynamically
    const currentKey = process.env.RESEND_API_KEY;
    if (currentKey && currentKey.trim().startsWith('re_') && !resendClient) {
      resendClient = new Resend(currentKey.trim());
    }

    if (!resendClient) {
      console.log(`📨 [Resend Simulated Dispatch]\n  To: ${to}\n  Subject: ${subject}\n  From: ${DEFAULT_FROM}\n  Reply-To: ${replyTo || 'N/A'}`);
      return {
        success: true,
        simulated: true,
        message: 'Email logged (no live RESEND_API_KEY configured).'
      };
    }

    const payload = {
      from: DEFAULT_FROM,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text: text || subject
    };

    if (replyTo) {
      payload.reply_to = replyTo;
    }

    const { data, error } = await resendClient.emails.send(payload);

    if (error) {
      console.error('❌ [Resend Error]:', error);
      return { success: false, error };
    }

    console.log(`✅ [Resend Dispatched] Email sent successfully to ${to}. Message ID: ${data?.id}`);
    return { success: true, id: data?.id };
  } catch (err) {
    console.error('❌ [Resend Dispatch Exception]:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Master Email HTML Wrapper
 */
function wrapTemplate(title, preheader, contentHtml) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; }
    table { border-collapse: collapse; }
    .container { max-width: 600px; margin: 30px auto; background-color: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 25px rgba(0, 52, 50, 0.08); border: 1px solid #e2e8f0; }
    .header { background-color: #003432; padding: 32px 30px; text-align: center; border-bottom: 3px solid #0BB4D2; }
    .brand-pill { display: inline-block; background-color: #0BB4D2; color: #003432; font-weight: 900; font-size: 13px; padding: 4px 10px; border-radius: 8px; margin-bottom: 8px; letter-spacing: 0.5px; }
    .brand-title { color: #ffffff; font-size: 20px; font-weight: 800; letter-spacing: 0.5px; margin: 0; }
    .brand-subtitle { color: #5eead4; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; margin-top: 4px; font-weight: 700; }
    .body { padding: 36px 32px; font-size: 14px; line-height: 1.6; color: #334155; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }
    .badge-debit { background-color: #fee2e2; color: #991b1b; }
    .badge-credit { background-color: #d1fae5; color: #065f46; }
    .badge-support { background-color: #e0f2fe; color: #0369a1; }
    .card-box { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px; margin: 20px 0; }
    .metric-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px dashed #cbd5e1; font-size: 13px; }
    .metric-row:last-child { border-bottom: none; }
    .metric-label { color: #64748b; font-weight: 600; }
    .metric-val { color: #0f172a; font-weight: 700; text-align: right; }
    .btn { display: inline-block; background-color: #003432; color: #ffffff !important; text-decoration: none; padding: 13px 28px; border-radius: 12px; font-size: 13px; font-weight: 700; margin-top: 24px; text-align: center; }
    .footer { background-color: #f8fafc; padding: 24px 30px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #f1f5f9; line-height: 1.5; }
    .footer-secure { display: inline-flex; align-items: center; gap: 6px; color: #003432; font-weight: 700; margin-bottom: 8px; }
  </style>
</head>
<body>
  <div style="display: none; max-height: 0px; overflow: hidden;">${preheader}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center">
        <div class="container">
          <!-- Header -->
          <div class="header">
            <div class="brand-pill">VA</div>
            <h1 class="brand-title">Obsidian Trust Bancorp Plc</h1>
            <div class="brand-subtitle">Commercial Banking &amp; Institutional Treasury</div>
          </div>
          
          <!-- Content Body -->
          <div class="body">
            ${contentHtml}
          </div>

          <!-- Security Footer -->
          <div class="footer">
            <div class="footer-secure">🔒 256-Bit SSL Encrypted Banking Communication</div>
            <div>&copy; 2026 Obsidian Trust Bancorp Plc. Authorized &amp; Regulated Commercial Banking Institution.</div>
            <div style="margin-top: 4px;">12 Bridlesmith Walk, Nottingham, NG1 2HB, United Kingdom</div>
            <div style="margin-top: 10px; font-size: 10px; color: #cbd5e1;">This is an automated institutional notification from your Obsidian Trust Bancorp account.</div>
          </div>
        </div>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * 1. Outward Funds Transfer / Wire Debit Alert
 */
async function sendDebitAlert({
  to,
  customerName,
  amount,
  fee = 0,
  currency = 'USD',
  recipientName,
  recipientBank,
  recipientAccount,
  reference,
  channel = 'WIRE TRANSFER',
  newBalance
}) {
  const formattedAmt = Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const formattedFee = Number(fee).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const formattedBal = newBalance !== undefined 
    ? Number(newBalance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : null;

  const content = `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
      <span class="badge badge-debit">Debit Alert (Outward)</span>
      <span style="font-size: 12px; color: #64748b;">${new Date().toUTCString()}</span>
    </div>

    <h2 style="font-size: 18px; color: #003432; margin-top: 0; font-weight: 800;">Dear ${customerName || 'Valued Client'},</h2>
    <p>We confirm that an outward funds transfer of <strong>${currency} ${formattedAmt}</strong> has been debited from your Obsidian Trust Bancorp account.</p>

    <div class="card-box">
      <table width="100%" cellspacing="0" cellpadding="6">
        <tr>
          <td class="metric-label">Transfer Amount:</td>
          <td class="metric-val" style="color: #b91c1c; font-size: 15px;">-${currency} ${formattedAmt}</td>
        </tr>
        <tr>
          <td class="metric-label">Clearing Fee:</td>
          <td class="metric-val">${currency} ${formattedFee}</td>
        </tr>
        <tr>
          <td class="metric-label">Beneficiary:</td>
          <td class="metric-val">${recipientName}</td>
        </tr>
        ${recipientBank ? `<tr><td class="metric-label">Destination Bank:</td><td class="metric-val">${recipientBank}</td></tr>` : ''}
        ${recipientAccount ? `<tr><td class="metric-label">Destination Account:</td><td class="metric-val">${recipientAccount}</td></tr>` : ''}
        <tr>
          <td class="metric-label">Channel:</td>
          <td class="metric-val">${channel}</td>
        </tr>
        <tr>
          <td class="metric-label">Reference Number:</td>
          <td class="metric-val" style="font-family: monospace;">${reference}</td>
        </tr>
        ${formattedBal ? `
        <tr style="border-top: 2px solid #e2e8f0;">
          <td class="metric-label" style="font-weight: 800; color: #003432;">Updated Balance:</td>
          <td class="metric-val" style="font-weight: 800; color: #003432; font-size: 15px;">${currency} ${formattedBal}</td>
        </tr>` : ''}
      </table>
    </div>

    <p style="font-size: 12px; color: #64748b;">If you did not authorize this transaction, please immediately freeze your account or contact our 24/7 Dispute Desk.</p>

    <div style="text-align: center;">
      <a href="${process.env.FRONTEND_URL || 'http://localhost:4200'}/e-banking/statement" class="btn">View Official Statement &rarr;</a>
    </div>
  `;

  return sendEmail({
    to,
    subject: `[Debit Alert] -${currency} ${formattedAmt} Dispatched | Obsidian Trust Bancorp`,
    html: wrapTemplate(`Debit Alert - ${currency} ${formattedAmt}`, `Outward transfer of ${currency} ${formattedAmt} confirmed`, content)
  });
}

/**
 * 2. Inward Deposit Credit Alert
 */
async function sendCreditAlert({
  to,
  customerName,
  amount,
  currency = 'USD',
  senderName,
  reference,
  newBalance
}) {
  const formattedAmt = Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const formattedBal = newBalance !== undefined 
    ? Number(newBalance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : null;

  const content = `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
      <span class="badge badge-credit">Credit Alert (Inward)</span>
      <span style="font-size: 12px; color: #64748b;">${new Date().toUTCString()}</span>
    </div>

    <h2 style="font-size: 18px; color: #003432; margin-top: 0; font-weight: 800;">Dear ${customerName || 'Valued Client'},</h2>
    <p>Your deposit has cleared and the sum of <strong>+${currency} ${formattedAmt}</strong> has been credited to your Obsidian Trust Bancorp ledger.</p>

    <div class="card-box">
      <table width="100%" cellspacing="0" cellpadding="6">
        <tr>
          <td class="metric-label">Credit Amount:</td>
          <td class="metric-val" style="color: #047857; font-size: 16px;">+${currency} ${formattedAmt}</td>
        </tr>
        <tr>
          <td class="metric-label">Origin / Payer:</td>
          <td class="metric-val">${senderName || 'Institutional Inward Clearing'}</td>
        </tr>
        <tr>
          <td class="metric-label">Tracking Reference:</td>
          <td class="metric-val" style="font-family: monospace;">${reference}</td>
        </tr>
        ${formattedBal ? `
        <tr style="border-top: 2px solid #e2e8f0;">
          <td class="metric-label" style="font-weight: 800; color: #003432;">Available Balance:</td>
          <td class="metric-val" style="font-weight: 800; color: #003432; font-size: 15px;">${currency} ${formattedBal}</td>
        </tr>` : ''}
      </table>
    </div>

    <div style="text-align: center;">
      <a href="${process.env.FRONTEND_URL || 'http://localhost:4200'}/e-banking/overview" class="btn">Access Client Dashboard &rarr;</a>
    </div>
  `;

  return sendEmail({
    to,
    subject: `[Credit Alert] +${currency} ${formattedAmt} Cleared | Obsidian Trust Bancorp`,
    html: wrapTemplate(`Credit Alert +${currency} ${formattedAmt}`, `Your deposit of ${currency} ${formattedAmt} is available`, content)
  });
}

/**
 * 3. Support Ticket Confirmation (Customer Created Ticket)
 */
async function sendSupportTicketCreatedAlert({
  to,
  customerName,
  ticketNumber,
  subject,
  department,
  priority
}) {
  const content = `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
      <span class="badge badge-support">Ticket Lodged</span>
      <span style="font-size: 12px; color: #64748b;">${new Date().toUTCString()}</span>
    </div>

    <h2 style="font-size: 18px; color: #003432; margin-top: 0; font-weight: 800;">Dear ${customerName || 'Valued Client'},</h2>
    <p>Your support inquiry has been successfully registered with the Obsidian Trust Bancorp Executive Help Desk.</p>

    <div class="card-box">
      <table width="100%" cellspacing="0" cellpadding="6">
        <tr>
          <td class="metric-label">Ticket Reference:</td>
          <td class="metric-val" style="font-family: monospace; font-size: 14px; color: #003432;">${ticketNumber}</td>
        </tr>
        <tr>
          <td class="metric-label">Subject:</td>
          <td class="metric-val">${subject}</td>
        </tr>
        <tr>
          <td class="metric-label">Department:</td>
          <td class="metric-val">${department}</td>
        </tr>
        <tr>
          <td class="metric-label">Priority:</td>
          <td class="metric-val">${priority}</td>
        </tr>
      </table>
    </div>

    <p style="font-size: 13px; color: #475569;">A dedicated compliance officer has been assigned to your case. You can monitor progress and chat directly with our officers from your client dashboard.</p>

    <div style="text-align: center;">
      <a href="${process.env.FRONTEND_URL || 'http://localhost:4200'}/e-banking/support" class="btn">View Ticket Thread &rarr;</a>
    </div>
  `;

  return sendEmail({
    to,
    subject: `[Support Case ${ticketNumber}] Inquiry Received: ${subject}`,
    html: wrapTemplate(`Support Ticket Confirmation: ${ticketNumber}`, `Case ${ticketNumber} opened successfully`, content)
  });
}

/**
 * 4. Support Ticket Officer Reply Alert (Admin Replied)
 */
async function sendSupportTicketReplyAlert({
  to,
  customerName,
  ticketNumber,
  subject,
  officerName,
  replyMessage
}) {
  const content = `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
      <span class="badge badge-credit">Officer Response</span>
      <span style="font-size: 12px; color: #64748b;">${new Date().toUTCString()}</span>
    </div>

    <h2 style="font-size: 18px; color: #003432; margin-top: 0; font-weight: 800;">Dear ${customerName || 'Valued Client'},</h2>
    <p>A Obsidian Trust Bancorp Support Officer has provided an update on case <strong>${ticketNumber}</strong> (${subject}):</p>

    <div style="background-color: #003432; color: #ffffff; padding: 22px; border-radius: 16px; border-left: 4px solid #0BB4D2; margin: 20px 0; font-size: 13px; line-height: 1.6; white-space: pre-line;">
      <div style="font-size: 11px; text-transform: uppercase; color: #5eead4; font-weight: 800; margin-bottom: 8px;">
        Response from ${officerName || 'Executive Officer'}:
      </div>
      ${replyMessage}
    </div>

    <p style="font-size: 13px; color: #475569;">You may reply directly to this officer by accessing your Support &amp; Dispute Resolution Desk.</p>

    <div style="text-align: center;">
      <a href="${process.env.FRONTEND_URL || 'http://localhost:4200'}/e-banking/support" class="btn">Reply in Client Portal &rarr;</a>
    </div>
  `;

  return sendEmail({
    to,
    subject: `[Support Update ${ticketNumber}] New Response from Executive Desk`,
    html: wrapTemplate(`Update on Case ${ticketNumber}`, `Officer response received for case ${ticketNumber}`, content)
  });
}

/**
 * 5. Security Login Alert
 */
async function sendSecurityLoginAlert({
  to,
  customerName,
  ipAddress,
  userAgent,
  timestamp
}) {
  const content = `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
      <span class="badge badge-support">Security Notification</span>
      <span style="font-size: 12px; color: #64748b;">${new Date().toUTCString()}</span>
    </div>

    <h2 style="font-size: 18px; color: #003432; margin-top: 0; font-weight: 800;">Dear ${customerName || 'Valued Client'},</h2>
    <p>A successful sign-in to your Obsidian Trust Bancorp Private Banking account was completed using your master credentials and two-tier transaction PIN.</p>

    <div class="card-box">
      <table width="100%" cellspacing="0" cellpadding="6">
        <tr>
          <td class="metric-label">Access Time:</td>
          <td class="metric-val">${timestamp || new Date().toUTCString()}</td>
        </tr>
        <tr>
          <td class="metric-label">IP Address:</td>
          <td class="metric-val" style="font-family: monospace;">${ipAddress || 'Client Network'}</td>
        </tr>
        <tr>
          <td class="metric-label">Device / Browser:</td>
          <td class="metric-val" style="font-size: 11px;">${userAgent || 'Web Browser'}</td>
        </tr>
      </table>
    </div>

    <p style="font-size: 12px; color: #dc2626; font-weight: 600;">If this was NOT you, please immediately lock your cards and reset your transaction PIN from security settings.</p>

    <div style="text-align: center;">
      <a href="${process.env.FRONTEND_URL || 'http://localhost:4200'}/e-banking/settings" class="btn">Inspect Account Security &rarr;</a>
    </div>
  `;

  return sendEmail({
    to,
    subject: `[Security Alert] Successful Login to Obsidian Trust Bancorp Account`,
    html: wrapTemplate('Obsidian Trust Bancorp Security Sign-In Alert', 'New sign-in detected on your account', content)
  });
}

/**
 * 6. Resend Test Email
 */
async function sendTestEmail({ to }) {
  const content = `
    <div style="text-align: center; padding: 20px 0;">
      <div style="font-size: 40px; margin-bottom: 10px;">⚡</div>
      <h2 style="font-size: 22px; color: #003432; margin: 0 0 10px; font-weight: 900;">Resend API Integration Active</h2>
      <p style="font-size: 14px; color: #475569; max-width: 440px; margin: 0 auto 20px;">
        Congratulations! Your Obsidian Trust Bancorp Resend API integration is fully operational and authenticated.
      </p>

      <div class="card-box" style="text-align: left;">
        <table width="100%" cellspacing="0" cellpadding="6">
          <tr>
            <td class="metric-label">Service Provider:</td>
            <td class="metric-val">Resend (resend.com)</td>
          </tr>
          <tr>
            <td class="metric-label">Sender Address:</td>
            <td class="metric-val">${DEFAULT_FROM}</td>
          </tr>
          <tr>
            <td class="metric-label">Destination Recipient:</td>
            <td class="metric-val">${to}</td>
          </tr>
          <tr>
            <td class="metric-label">Dispatch Status:</td>
            <td class="metric-val" style="color: #059669; font-weight: 800;">VERIFIED 200 OK</td>
          </tr>
        </table>
      </div>
    </div>
  `;

  return sendEmail({
    to,
    subject: `[Resend Verification] Obsidian Trust Bancorp Live Email Test`,
    html: wrapTemplate('Resend API Verification Successful', 'Your email API key is functioning properly', content)
  });
}

/**
 * 7. Customer to Admin Direct Support Email
 */
async function sendUserToAdminSupportEmail({
  fromUser,
  customerName,
  accountNumber,
  subject,
  department = 'GENERAL_SUPPORT',
  priority = 'MEDIUM',
  message,
  ticketNumber
}) {
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || 'admin@obsidiantrustbancorp.com';
  const cleanDepartment = (department || 'GENERAL_SUPPORT').replace(/_/g, ' ');
  const cleanPriority = (priority || 'MEDIUM').toUpperCase();
  const priorityColor = cleanPriority === 'URGENT' || cleanPriority === 'HIGH' ? '#dc2626' : '#0284c7';

  const content = `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
      <span class="badge" style="background-color: #fef3c7; color: #92400e; font-weight: 800;">Client Support Inquiry</span>
      <span style="font-size: 12px; color: #64748b;">${new Date().toUTCString()}</span>
    </div>

    <h2 style="font-size: 18px; color: #003432; margin-top: 0; font-weight: 800;">Executive Support Dispatch</h2>
    <p>A direct inquiry has been transmitted by an authenticated client to the Obsidian Trust Bancorp Executive Help Desk.</p>

    <div class="card-box">
      <table width="100%" cellspacing="0" cellpadding="6">
        <tr>
          <td class="metric-label">Sender Client:</td>
          <td class="metric-val" style="color: #003432; font-weight: 800;">${customerName || fromUser?.fullName || 'Client'}</td>
        </tr>
        <tr>
          <td class="metric-label">Client Email:</td>
          <td class="metric-val"><a href="mailto:${fromUser?.email}" style="color: #0284c7; text-decoration: none;">${fromUser?.email}</a></td>
        </tr>
        ${accountNumber ? `<tr><td class="metric-label">Account Number:</td><td class="metric-val" style="font-family: monospace;">${accountNumber}</td></tr>` : ''}
        ${ticketNumber ? `<tr><td class="metric-label">Docket / Ticket:</td><td class="metric-val" style="font-family: monospace; font-weight: 800; color: #003432;">${ticketNumber}</td></tr>` : ''}
        <tr>
          <td class="metric-label">Department:</td>
          <td class="metric-val">${cleanDepartment}</td>
        </tr>
        <tr>
          <td class="metric-label">Priority:</td>
          <td class="metric-val" style="color: ${priorityColor}; font-weight: 800;">${cleanPriority}</td>
        </tr>
        <tr>
          <td class="metric-label">Subject:</td>
          <td class="metric-val">${subject}</td>
        </tr>
      </table>
    </div>

    <div style="background-color: #f8fafc; border-left: 4px solid #003432; padding: 18px; border-radius: 8px; margin: 20px 0;">
      <div style="font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 800; margin-bottom: 8px;">Message Content:</div>
      <div style="font-size: 13px; color: #1e293b; line-height: 1.6; white-space: pre-line;">${message}</div>
    </div>

    <p style="font-size: 12px; color: #64748b;">
      You can reply directly to this email (sent with client reply-to header) or handle the case within the administrative command center.
    </p>

    <div style="text-align: center;">
      <a href="${process.env.FRONTEND_URL || 'http://localhost:4200'}/admin/support" class="btn">Open Case in Admin Desk &rarr;</a>
    </div>
  `;

  return sendEmail({
    to: adminEmail,
    replyTo: fromUser?.email,
    subject: `[Client Inquiry] ${subject} - ${customerName || fromUser?.email}`,
    html: wrapTemplate(`Client Support Inquiry: ${subject}`, `Inquiry received from ${customerName || fromUser?.email}`, content)
  });
}

/**
 * 8. Admin to User Customizable Executive Banking Email
 */
async function sendAdminCustomEmailToUser({
  toUserEmail,
  customerName,
  subject,
  headline,
  bodyText,
  callToActionLabel,
  callToActionUrl,
  senderOfficerName,
  priority = 'STANDARD',
  badgeText = 'OFFICIAL NOTICE'
}) {
  const cleanHeadline = headline || subject;
  const officer = senderOfficerName || 'Obsidian Trust Bancorp Executive Compliance Directorate';
  const ctaLabel = callToActionLabel || 'Access Client Portal &rarr;';
  const ctaUrl = callToActionUrl || `${process.env.FRONTEND_URL || 'http://localhost:4200'}/e-banking/overview`;

  const content = `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
      <span class="badge" style="background-color: #003432; color: #5eead4; font-weight: 800;">${badgeText}</span>
      <span style="font-size: 12px; color: #64748b;">${new Date().toUTCString()}</span>
    </div>

    <h2 style="font-size: 20px; color: #003432; margin-top: 0; font-weight: 900; line-height: 1.3;">
      ${cleanHeadline}
    </h2>

    <p style="font-size: 14px; color: #334155; margin-bottom: 18px;">
      Dear <strong>${customerName || 'Valued Client'}</strong>,
    </p>

    <div style="font-size: 14px; color: #334155; line-height: 1.7; margin: 20px 0; white-space: pre-line;">
${bodyText}
    </div>

    <div class="card-box" style="border-left: 4px solid #0BB4D2; background-color: #f0fdfa;">
      <div style="font-size: 11px; text-transform: uppercase; color: #0f766e; font-weight: 800; margin-bottom: 4px;">Institutional Sign-off</div>
      <div style="font-size: 13px; font-weight: 700; color: #003432;">${officer}</div>
      <div style="font-size: 11px; color: #64748b; margin-top: 2px;">Obsidian Trust Bancorp Plc &bull; Central Banking &amp; Treasury Operations</div>
    </div>

    <div style="text-align: center; margin-top: 28px;">
      <a href="${ctaUrl}" class="btn">${ctaLabel}</a>
    </div>
  `;

  return sendEmail({
    to: toUserEmail,
    subject: `[Obsidian Trust Bancorp Official] ${subject}`,
    html: wrapTemplate(subject, cleanHeadline, content)
  });
}

module.exports = {
  sendEmail,
  sendDebitAlert,
  sendCreditAlert,
  sendSupportTicketCreatedAlert,
  sendSupportTicketReplyAlert,
  sendSecurityLoginAlert,
  sendTestEmail,
  sendUserToAdminSupportEmail,
  sendAdminCustomEmailToUser
};
