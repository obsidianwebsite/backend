const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');

// List customer's multi-currency wallets and exchange rates
async function listWallets(req, res) {
  try {
    const userId = req.user.id;
    const accountId = req.user.account.id;

    // Get all supported currencies
    const supported = ['USD', 'EUR', 'GBP', 'NGN'];

    // Fetch existing wallets
    const [wallets] = await pool.execute(
      `SELECT * FROM wallets WHERE user_id = ? ORDER BY currency`,
      [userId]
    );

    // If user is missing any supported wallet, provision it with 0
    const existingCurrencies = wallets.map(w => w.currency);
    for (const curr of supported) {
      if (!existingCurrencies.includes(curr)) {
        await pool.execute(
          `INSERT INTO wallets (id, user_id, account_id, currency, balance)
           VALUES (?, ?, ?, ?, 0.0000)`,
          [uuidv4(), userId, accountId, curr]
        );
      }
    }

    // Re-fetch all
    const [updatedWallets] = await pool.execute(
      `SELECT * FROM wallets WHERE user_id = ? ORDER BY currency`,
      [userId]
    );

    // Fetch live exchange rates
    const [rates] = await pool.execute(
      `SELECT from_currency, to_currency, rate FROM exchange_rates ORDER BY from_currency, to_currency`
    );

    return res.status(200).json({
      success: true,
      data: {
        wallets: updatedWallets.map(w => ({
          id: w.id,
          currency: w.currency,
          balance: parseFloat(w.balance).toFixed(2),
          updatedAt: w.updated_at
        })),
        exchangeRates: rates
      }
    });
  } catch (err) {
    console.error('Error in listWallets:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch wallets.' });
  }
}

// Convert funds between currency wallets
async function convertCurrency(req, res) {
  const conn = await pool.getConnection();
  try {
    const userId = req.user.id;
    const accountId = req.user.account.id;
    const { fromCurrency, toCurrency, amount } = req.body;

    const convertAmount = parseFloat(amount);
    if (!fromCurrency || !toCurrency || fromCurrency === toCurrency || isNaN(convertAmount) || convertAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid currency pair or non-positive conversion amount.'
      });
    }

    await conn.beginTransaction();

    // Check source wallet
    const [sourceWallets] = await conn.execute(
      `SELECT * FROM wallets WHERE user_id = ? AND currency = ? FOR UPDATE`,
      [userId, fromCurrency]
    );

    if (sourceWallets.length === 0) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: `Source wallet for ${fromCurrency} not found.` });
    }

    const sourceWallet = sourceWallets[0];
    const sourceBalance = parseFloat(sourceWallet.balance);

    if (sourceBalance < convertAmount) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: `Insufficient ${fromCurrency} funds. Available: ${sourceBalance.toFixed(2)}, Requested: ${convertAmount.toFixed(2)}.`
      });
    }

    // Get exchange rate
    const [rateRows] = await conn.execute(
      `SELECT rate FROM exchange_rates WHERE from_currency = ? AND to_currency = ? LIMIT 1`,
      [fromCurrency, toCurrency]
    );

    let rate = 1.0;
    if (rateRows.length > 0) {
      rate = parseFloat(rateRows[0].rate);
    } else {
      // Try reverse rate
      const [revRows] = await conn.execute(
        `SELECT rate FROM exchange_rates WHERE from_currency = ? AND to_currency = ? LIMIT 1`,
        [toCurrency, fromCurrency]
      );
      if (revRows.length > 0 && parseFloat(revRows[0].rate) > 0) {
        rate = 1 / parseFloat(revRows[0].rate);
      } else {
        await conn.rollback();
        return res.status(400).json({
          success: false,
          message: `Exchange rate for ${fromCurrency} -> ${toCurrency} is not configured.`
        });
      }
    }

    const targetCredit = convertAmount * rate;

    // Deduct source wallet
    await conn.execute(
      `UPDATE wallets SET balance = balance - ? WHERE id = ?`,
      [convertAmount, sourceWallet.id]
    );

    // Get or create destination wallet
    const [destWallets] = await conn.execute(
      `SELECT * FROM wallets WHERE user_id = ? AND currency = ? FOR UPDATE`,
      [userId, toCurrency]
    );

    let destWalletId;
    if (destWallets.length === 0) {
      destWalletId = uuidv4();
      await conn.execute(
        `INSERT INTO wallets (id, user_id, account_id, currency, balance) VALUES (?, ?, ?, ?, ?)`,
        [destWalletId, userId, accountId, toCurrency, targetCredit]
      );
    } else {
      destWalletId = destWallets[0].id;
      await conn.execute(
        `UPDATE wallets SET balance = balance + ? WHERE id = ?`,
        [targetCredit, destWalletId]
      );
    }

    // If source or target is primary USD account currency, synchronize primary account available_balance
    if (fromCurrency === 'USD') {
      await conn.execute(
        `UPDATE accounts SET available_balance = available_balance - ?, ledger_balance = ledger_balance - ? WHERE id = ?`,
        [convertAmount, convertAmount, accountId]
      );
    } else if (toCurrency === 'USD') {
      await conn.execute(
        `UPDATE accounts SET available_balance = available_balance + ?, ledger_balance = ledger_balance + ? WHERE id = ?`,
        [targetCredit, targetCredit, accountId]
      );
    }

    // Post Transaction Record
    const ref = `FX-${Date.now().toString().slice(-8)}`;
    await conn.execute(
      `INSERT INTO transactions (
        id, account_id, reference_number, transaction_type, channel, 
        amount, fee, currency, counterparty_name, counterparty_bank, 
        counterparty_account, narration, status, post_date
      ) VALUES (?, ?, ?, 'DEBIT', 'WALLET_EXCHANGE', ?, 0.0000, ?, ?, 'Obsidian Trust Bancorp Multi-Currency FX Engine', 'FX-DESK', ?, 'COMPLETED', NOW())`,
      [
        uuidv4(),
        accountId,
        ref,
        convertAmount,
        fromCurrency,
        `Multi-Currency Wallet Conversion to ${toCurrency}`,
        `Exchanged ${convertAmount.toFixed(2)} ${fromCurrency} to ${targetCredit.toFixed(2)} ${toCurrency} @ rate ${rate.toFixed(4)}`
      ]
    );

    await conn.commit();

    return res.status(200).json({
      success: true,
      message: `Successfully exchanged ${convertAmount.toFixed(2)} ${fromCurrency} to ${targetCredit.toFixed(2)} ${toCurrency}!`,
      data: {
        referenceNumber: ref,
        fromCurrency,
        toCurrency,
        exchangedAmount: convertAmount.toFixed(2),
        creditedAmount: targetCredit.toFixed(2),
        rate: rate.toFixed(6)
      }
    });
  } catch (err) {
    await conn.rollback();
    console.error('Error in convertCurrency:', err);
    return res.status(500).json({ success: false, message: 'Failed to execute currency conversion.' });
  } finally {
    conn.release();
  }
}

module.exports = {
  listWallets,
  convertCurrency
};
