const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');
const emailService = require('../services/email.service');

// Initiate Domestic, Local, or International Wire Transfer
async function createTransfer(req, res) {
  const conn = await pool.getConnection();
  try {
    const accountId = req.user.account.id;
    const userId = req.user.id;

    const {
      rname,          // Receiver's Name
      rbank,          // Receiver's Bank Name
      iban,           // Bank Address / IBAN
      accno,          // Receiver's Account Number
      swift,          // SWIFT / ABA Routing Code
      type,           // Transaction Type ('DT', 'LT', 'IT')
      amt,            // Transfer Amount
      comment,        // Transaction Narration / Memo
      saveBeneficiary // Boolean: whether to save beneficiary
    } = req.body;

    // Validate Input
    if (!rname || !rbank || !accno || !amt || !type) {
      return res.status(400).json({
        success: false,
        status: 'VALIDATION_ERROR',
        message: "One (1) or more receiver's fields not completed. Please fill all required fields."
      });
    }

    const transferAmount = parseFloat(amt);
    if (isNaN(transferAmount) || transferAmount <= 0) {
      return res.status(400).json({
        success: false,
        status: 'INVALID_AMOUNT',
        message: 'Transfer amount must be a valid positive number.'
      });
    }

    // Determine Channel and Transfer Fee
    let channel = 'LOCAL_TRANSFER';
    let fee = 0.0000;
    if (type === 'DT') {
      channel = 'DOMESTIC_TRANSFER';
      fee = 5.0000;
    } else if (type === 'IT') {
      channel = 'INTERNATIONAL_WIRE';
      fee = 25.0000;
    } else {
      channel = 'LOCAL_TRANSFER';
      fee = 0.0000;
    }

    const totalDeduction = transferAmount + fee;

    await conn.beginTransaction();

    // Check Current Balance with FOR UPDATE lock
    const [accRows] = await conn.execute(
      `SELECT available_balance, ledger_balance, currency, status 
       FROM accounts 
       WHERE id = ? FOR UPDATE`,
      [accountId]
    );

    if (!accRows || accRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({
        success: false,
        status: 'ACCOUNT_NOT_FOUND',
        message: 'Account not found.'
      });
    }

    const currentBalance = parseFloat(accRows[0].available_balance);
    if (currentBalance < totalDeduction) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        status: 'INSUFFICIENT_FUNDS',
        message: `Insufficient funds. Available balance: $${currentBalance.toFixed(2)}, Required: $${totalDeduction.toFixed(2)} (including $${fee.toFixed(2)} wire fee).`
      });
    }

    // Deduct Funds from Account
    const newAvailable = currentBalance - totalDeduction;
    const newLedger = parseFloat(accRows[0].ledger_balance) - totalDeduction;

    await conn.execute(
      `UPDATE accounts 
       SET available_balance = ?, ledger_balance = ? 
       WHERE id = ?`,
      [newAvailable, newLedger, accountId]
    );

    // Generate Transaction Reference
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    const randCode = Math.floor(1000 + Math.random() * 9000);
    const referenceNumber = `TXN-OTB-${dateStr}-${randCode}`;
    const txnId = uuidv4();

    // Insert Debit Transaction
    await conn.execute(
      `INSERT INTO transactions (
        id, account_id, reference_number, transaction_type, channel, 
        amount, fee, currency, counterparty_name, counterparty_bank, 
        counterparty_account, counterparty_swift_routing, narration, status
      ) VALUES (?, ?, ?, 'DEBIT', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED')`,
      [
        txnId,
        accountId,
        referenceNumber,
        channel,
        transferAmount,
        fee,
        accRows[0].currency,
        rname.trim(),
        rbank.trim(),
        accno.trim(),
        swift ? swift.trim() : null,
        comment ? comment.trim() : `Outward ${channel.replace('_', ' ')} to ${rname}`
      ]
    );

    // Optionally Save Beneficiary
    if (saveBeneficiary) {
      const [existingBen] = await conn.execute(
        `SELECT id FROM beneficiaries WHERE account_id = ? AND account_number = ? LIMIT 1`,
        [accountId, accno.trim()]
      );

      if (existingBen.length === 0) {
        await conn.execute(
          `INSERT INTO beneficiaries (id, account_id, name, bank_name, account_number, swift_routing, bank_address)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            uuidv4(),
            accountId,
            rname.trim(),
            rbank.trim(),
            accno.trim(),
            swift ? swift.trim() : null,
            iban ? iban.trim() : null
          ]
        );
      }
    }

    // Insert Audit Log
    await conn.execute(
      `INSERT INTO audit_logs (id, user_id, event_type, ip_address, user_agent, metadata)
       VALUES (?, ?, 'FUNDS_TRANSFERRED', ?, ?, ?)`,
      [
        uuidv4(),
        userId,
        req.user.clientIp,
        req.headers['user-agent'] || 'Browser Client',
        JSON.stringify({
          referenceNumber,
          channel,
          amount: transferAmount,
          fee,
          recipient: rname
        })
      ]
    );

    await conn.commit();

    // Asynchronously dispatch Resend Debit Alert
    if (req.user && req.user.email) {
      emailService.sendDebitAlert({
        to: req.user.email,
        customerName: req.user.fullName || 'Valued Client',
        amount: transferAmount,
        fee,
        currency: accRows[0].currency,
        recipientName: rname.trim(),
        recipientBank: rbank.trim(),
        recipientAccount: accno.trim(),
        reference: referenceNumber,
        channel: channel.replace('_', ' '),
        newBalance: newAvailable
      }).catch(err => console.error('[Email Debit Alert Error]:', err));
    }

    return res.status(200).json({
      success: true,
      status: 'SUCCESS',
      message: 'Funds transfer successfully dispatched and debited from your account.',
      data: {
        referenceNumber,
        amount: transferAmount.toFixed(2),
        fee: fee.toFixed(2),
        totalDebited: totalDeduction.toFixed(2),
        currency: accRows[0].currency,
        recipient: rname,
        remainingBalance: newAvailable.toFixed(2),
        postDate: new Date().toISOString()
      }
    });
  } catch (err) {
    await conn.rollback();
    console.error('Error in createTransfer:', err);
    return res.status(500).json({
      success: false,
      status: 'TRANSFER_FAILED',
      message: 'Transaction failed due to an unexpected system error. No funds were debited.'
    });
  } finally {
    conn.release();
  }
}

// Internal User-to-User Transfer (via Email or Account Number)
async function createInternalTransfer(req, res) {
  const conn = await pool.getConnection();
  try {
    const senderAccountId = req.user.account.id;
    const senderUserId = req.user.id;
    const { recipientIdentifier, amount, narration } = req.body;

    if (!recipientIdentifier || !amount) {
      return res.status(400).json({
        success: false,
        status: 'VALIDATION_ERROR',
        message: 'Recipient identifier (email or account number) and amount are required.'
      });
    }

    const transferAmount = parseFloat(amount);
    if (isNaN(transferAmount) || transferAmount <= 0) {
      return res.status(400).json({
        success: false,
        status: 'INVALID_AMOUNT',
        message: 'Transfer amount must be a positive number.'
      });
    }

    await conn.beginTransaction();

    // 1. Lock and check sender account
    const [senderAccs] = await conn.execute(
      `SELECT a.id, a.available_balance, a.ledger_balance, a.currency, a.account_number, u.first_name, u.last_name, u.email
       FROM accounts a
       JOIN users u ON u.id = a.user_id
       WHERE a.id = ? FOR UPDATE`,
      [senderAccountId]
    );

    if (!senderAccs || senderAccs.length === 0) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Sender account not found.' });
    }

    const sender = senderAccs[0];
    const senderBal = parseFloat(sender.available_balance);

    if (senderBal < transferAmount) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        status: 'INSUFFICIENT_FUNDS',
        message: `Insufficient funds. Available: $${senderBal.toFixed(2)}, Required: $${transferAmount.toFixed(2)}.`
      });
    }

    // 2. Locate recipient by email or account number
    const [recipients] = await conn.execute(
      `SELECT a.id AS account_id, a.available_balance, a.ledger_balance, a.account_number, u.id AS user_id, u.first_name, u.last_name, u.email
       FROM accounts a
       JOIN users u ON u.id = a.user_id
       WHERE (u.email = ? OR a.account_number = ?) AND a.status = 'ACTIVE' FOR UPDATE`,
      [recipientIdentifier.trim(), recipientIdentifier.trim()]
    );

    if (!recipients || recipients.length === 0) {
      await conn.rollback();
      return res.status(404).json({
        success: false,
        status: 'RECIPIENT_NOT_FOUND',
        message: 'Recipient account or email not found or account is not active.'
      });
    }

    const recipient = recipients[0];

    if (recipient.account_id === senderAccountId || recipient.user_id === senderUserId) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        status: 'INVALID_RECIPIENT',
        message: 'You cannot perform an internal transfer to your own account.'
      });
    }

    // 3. Atomically update sender and recipient balances
    const newSenderBal = senderBal - transferAmount;
    const newSenderLedger = parseFloat(sender.ledger_balance) - transferAmount;
    await conn.execute(
      `UPDATE accounts SET available_balance = ?, ledger_balance = ? WHERE id = ?`,
      [newSenderBal, newSenderLedger, senderAccountId]
    );

    const newRecipBal = parseFloat(recipient.available_balance) + transferAmount;
    const newRecipLedger = parseFloat(recipient.ledger_balance) + transferAmount;
    await conn.execute(
      `UPDATE accounts SET available_balance = ?, ledger_balance = ? WHERE id = ?`,
      [newRecipBal, newRecipLedger, recipient.account_id]
    );

    // 4. Generate transaction references and records
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    const randCode = Math.floor(1000 + Math.random() * 9000);
    const refDebit = `TXN-INT-D-${dateStr}-${randCode}`;
    const refCredit = `TXN-INT-C-${dateStr}-${randCode}`;

    const senderFullName = `${sender.first_name} ${sender.last_name}`;
    const recipientFullName = `${recipient.first_name} ${recipient.last_name}`;

    // Sender Debit
    await conn.execute(
      `INSERT INTO transactions (
        id, account_id, reference_number, transaction_type, channel, 
        amount, fee, currency, counterparty_name, counterparty_bank, 
        counterparty_account, narration, status
      ) VALUES (?, ?, ?, 'DEBIT', 'LOCAL_TRANSFER', ?, 0, 'USD', ?, 'VaultProvenance Internal', ?, ?, 'COMPLETED')`,
      [uuidv4(), senderAccountId, refDebit, transferAmount, recipientFullName, recipient.account_number, narration || 'Internal Peer-to-Peer Transfer']
    );

    // Recipient Credit
    await conn.execute(
      `INSERT INTO transactions (
        id, account_id, reference_number, transaction_type, channel, 
        amount, fee, currency, counterparty_name, counterparty_bank, 
        counterparty_account, narration, status
      ) VALUES (?, ?, ?, 'CREDIT', 'LOCAL_TRANSFER', ?, 0, 'USD', ?, 'VaultProvenance Internal', ?, ?, 'COMPLETED')`,
      [uuidv4(), recipient.account_id, refCredit, transferAmount, senderFullName, sender.account_number, narration || `Internal Transfer from ${senderFullName}`]
    );

    await conn.commit();

    return res.status(200).json({
      success: true,
      status: 'SUCCESS',
      message: `Successfully transferred $${transferAmount.toFixed(2)} to ${recipientFullName}.`,
      data: {
        referenceNumber: refDebit,
        amount: transferAmount.toFixed(2),
        recipient: recipientFullName,
        recipientAccount: recipient.account_number,
        remainingBalance: newSenderBal.toFixed(2),
        postDate: new Date().toISOString()
      }
    });
  } catch (err) {
    await conn.rollback();
    console.error('Error in createInternalTransfer:', err);
    return res.status(500).json({
      success: false,
      status: 'TRANSFER_FAILED',
      message: 'Internal transfer failed due to a system error.'
    });
  } finally {
    conn.release();
  }
}

module.exports = {
  createTransfer,
  createInternalTransfer
};
