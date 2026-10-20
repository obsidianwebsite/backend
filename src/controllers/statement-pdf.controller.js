const PDFDocument = require('pdfkit');
const pool = require('../config/db');

async function downloadStatementPdf(req, res) {
  try {
    const accountId = req.user.account.id;
    const user = req.user;

    // Fetch refreshed account details
    const [accRows] = await pool.execute(
      `SELECT * FROM accounts WHERE id = ? LIMIT 1`,
      [accountId]
    );
    const account = accRows[0] || req.user.account;

    // Fetch transactions
    const [transactions] = await pool.execute(
      `SELECT * FROM transactions WHERE account_id = ? ORDER BY post_date DESC LIMIT 50`,
      [accountId]
    );

    // Compute metrics
    const [aggregates] = await pool.execute(
      `SELECT 
        COALESCE(SUM(CASE WHEN transaction_type = 'CREDIT' THEN amount ELSE 0 END), 0) AS total_inflow,
        COALESCE(SUM(CASE WHEN transaction_type = 'DEBIT' THEN amount ELSE 0 END), 0) AS total_outflow
       FROM transactions WHERE account_id = ?`,
      [accountId]
    );
    const totalInflow = parseFloat(aggregates[0].total_inflow || 0);
    const totalOutflow = parseFloat(aggregates[0].total_outflow || 0);

    const doc = new PDFDocument({ margin: 40, size: 'A4' });

    // Set response headers for file download
    const filename = `VaultProvenance_Bank_Statement_${account.account_number}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    doc.pipe(res);

    // --- 1. HEADER BANNER ---
    doc.rect(40, 40, 515, 60).fill('#003432');
    
    doc.fillColor('#0BB4D2')
       .fontSize(18)
       .font('Helvetica-Bold')
       .text('VAULTPROVENANCE BANK PLC', 55, 52);
    
    doc.fillColor('#ffffff')
       .fontSize(9)
       .font('Helvetica')
       .text('Institutional Treasury & Commercial Banking Services', 55, 74)
       .text('Canary Wharf Financial Centre, London E14 5AB | www.vaultprovenance.com', 55, 86);

    doc.fillColor('#28a745')
       .fontSize(10)
       .font('Helvetica-Bold')
       .text('DIGITALLY CERTIFIED STATEMENT', 320, 52, { align: 'right', width: 220 });
    
    doc.fillColor('#cbd5e1')
       .fontSize(8)
       .font('Helvetica')
       .text(`Generated: ${new Date().toUTCString()}`, 320, 68, { align: 'right', width: 220 });

    doc.moveDown(4.5);

    // --- 2. CUSTOMER & ACCOUNT SUMMARY GRID ---
    const startY = 115;
    
    // Customer Info Card
    doc.rect(40, startY, 250, 85).fillAndStroke('#f8fafc', '#cbd5e1');
    doc.fillColor('#0f172a').fontSize(9).font('Helvetica-Bold').text('ACCOUNT HOLDER DETAILS', 50, startY + 10);
    doc.fillColor('#334155').fontSize(8).font('Helvetica')
       .text(`Name: ${user.fullName}`, 50, startY + 25)
       .text(`Email: ${user.email}`, 50, startY + 38)
       .text(`Phone: ${user.phone || '+44 20 7946 0912'}`, 50, startY + 51)
       .text(`Branch: London Canary Wharf Institutional Desk`, 50, startY + 64);

    // Account Summary Card
    doc.rect(305, startY, 250, 85).fillAndStroke('#f0f9ff', '#0284c7');
    doc.fillColor('#0369a1').fontSize(9).font('Helvetica-Bold').text('PORTFOLIO BALANCES', 315, startY + 10);
    doc.fillColor('#0f172a').fontSize(8).font('Helvetica')
       .text(`Account Number: ${account.account_number}`, 315, startY + 25)
       .text(`Account Type: ${account.account_type}`, 315, startY + 38)
       .text(`Available Balance: $${parseFloat(account.available_balance).toLocaleString('en-US', { minimumFractionDigits: 2 })} ${account.currency}`, 315, startY + 51)
       .text(`Ledger Balance: $${parseFloat(account.ledger_balance).toLocaleString('en-US', { minimumFractionDigits: 2 })} ${account.currency}`, 315, startY + 64);

    // Cashflow Inflow/Outflow Strip
    const flowY = startY + 95;
    doc.rect(40, flowY, 515, 25).fillAndStroke('#f1f5f9', '#94a3b8');
    doc.fillColor('#15803d').fontSize(8).font('Helvetica-Bold')
       .text(`Total Credits (Inflow): +$${totalInflow.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 50, flowY + 8);
    doc.fillColor('#b91c1c').fontSize(8).font('Helvetica-Bold')
       .text(`Total Debits (Outflow): -$${totalOutflow.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 220, flowY + 8);
    doc.fillColor('#475569').fontSize(8).font('Helvetica')
       .text(`Recorded Ledger Postings: ${transactions.length} items`, 410, flowY + 8);

    // --- 3. TRANSACTION LEDGER TABLE ---
    const tableTop = flowY + 35;
    doc.rect(40, tableTop, 515, 20).fill('#1b2a47');
    doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold')
       .text('DATE', 45, tableTop + 6)
       .text('REFERENCE', 105, tableTop + 6)
       .text('COUNTERPARTY / NARRATION', 190, tableTop + 6)
       .text('CHANNEL', 370, tableTop + 6)
       .text('AMOUNT', 440, tableTop + 6, { align: 'right', width: 65 })
       .text('STATUS', 510, tableTop + 6);

    let currentY = tableTop + 20;

    transactions.forEach((tx, index) => {
      if (currentY > 730) {
        doc.addPage();
        currentY = 40;
      }

      const isEven = index % 2 === 0;
      doc.rect(40, currentY, 515, 22).fill(isEven ? '#ffffff' : '#f8fafc');

      const dateStr = new Date(tx.post_date).toLocaleDateString('en-GB');
      const isCredit = tx.transaction_type === 'CREDIT';
      const amountStr = `${isCredit ? '+' : '-'}$${parseFloat(tx.amount).toFixed(2)}`;

      doc.fillColor('#475569').fontSize(7.5).font('Helvetica').text(dateStr, 45, currentY + 6);
      doc.fillColor('#0f172a').font('Helvetica-Bold').text(tx.reference_number.slice(0, 14), 105, currentY + 6);
      
      const desc = `${tx.counterparty_name || 'Bank Clearing'} - ${tx.narration || ''}`.slice(0, 36);
      doc.fillColor('#334155').font('Helvetica').text(desc, 190, currentY + 6);

      doc.fillColor('#64748b').text(tx.channel.replace(/_/g, ' '), 370, currentY + 6);

      doc.fillColor(isCredit ? '#16a34a' : '#dc2626')
         .font('Helvetica-Bold')
         .text(amountStr, 440, currentY + 6, { align: 'right', width: 65 });

      doc.fillColor('#0284c7').font('Helvetica').text(tx.status, 510, currentY + 6);

      currentY += 22;
    });

    // --- 4. OFFICIAL COMPLIANCE & VERIFICATION FOOTER ---
    const footerY = 760;
    doc.rect(40, footerY, 515, 45).fillAndStroke('#f8fafc', '#cbd5e1');
    doc.fillColor('#0f172a').fontSize(7.5).font('Helvetica-Bold')
       .text('OFFICIAL VERIFICATION NOTICE & REGULATORY COMPLIANCE', 48, footerY + 6);
    doc.fillColor('#64748b').fontSize(6.5).font('Helvetica')
       .text('This document constitutes a certified account ledger statement generated by VaultProvenance Core Banking Engine.', 48, footerY + 18)
       .text('For queries regarding transaction references or audit verification, contact treasury@vaultprovenance.com or telephone +44 20 7946 0912.', 48, footerY + 28)
       .text(`Security Hash: ${Buffer.from(account.account_number + user.id).toString('base64')} | Auth Code: VA-VERIFIED-2026`, 48, footerY + 36);

    doc.end();
  } catch (err) {
    console.error('Error generating statement PDF:', err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Failed to generate statement PDF.' });
    }
  }
}

module.exports = {
  downloadStatementPdf
};
