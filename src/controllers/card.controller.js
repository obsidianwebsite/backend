const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');

// List Cards associated with user's account
async function listCards(req, res) {
  try {
    const accountId = req.user.account.id;

    const [cards] = await pool.execute(
      `SELECT id, card_number_masked, card_holder_name, expiry_date, card_type, tier, cvv, brand, spending_limit, status, created_at
       FROM cards 
       WHERE account_id = ? 
       ORDER BY created_at DESC`,
      [accountId]
    );

    return res.status(200).json({
      success: true,
      status: 'SUCCESS',
      data: cards
    });
  } catch (err) {
    console.error('Error in listCards:', err);
    return res.status(500).json({
      success: false,
      status: 'SERVER_ERROR',
      message: 'Failed to retrieve card records.'
    });
  }
}

// Toggle Card Status (ACTIVE <-> FROZEN)
async function toggleCardStatus(req, res) {
  try {
    const accountId = req.user.account.id;
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['ACTIVE', 'INACTIVE', 'FROZEN'];
    if (!status || !validStatuses.includes(status.toUpperCase())) {
      return res.status(400).json({
        success: false,
        status: 'INVALID_STATUS',
        message: 'Valid card status is required: ACTIVE, INACTIVE, or FROZEN.'
      });
    }

    const newStatus = status.toUpperCase();

    const [result] = await pool.execute(
      `UPDATE cards SET status = ? WHERE id = ? AND account_id = ?`,
      [newStatus, id, accountId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        status: 'NOT_FOUND',
        message: 'Card record not found.'
      });
    }

    // Audit Log
    await pool.execute(
      `INSERT INTO audit_logs (id, user_id, event_type, ip_address, user_agent, metadata)
       VALUES (?, ?, 'CARD_STATUS_UPDATED', ?, ?, ?)`,
      [
        uuidv4(),
        req.user.id,
        req.user.clientIp,
        req.headers['user-agent'] || 'Browser Client',
        JSON.stringify({ cardId: id, newStatus })
      ]
    );

    return res.status(200).json({
      success: true,
      status: 'SUCCESS',
      message: `Card has been set to ${newStatus}.`,
      data: {
        cardId: id,
        status: newStatus
      }
    });
  } catch (err) {
    console.error('Error in toggleCardStatus:', err);
    return res.status(500).json({
      success: false,
      status: 'SERVER_ERROR',
      message: 'Failed to update card status.'
    });
  }
}

// Request New Virtual or Physical Card with Tiers
async function requestCard(req, res) {
  try {
    const accountId = req.user.account.id;
    const { 
      cardType = 'VIRTUAL', 
      brand = 'VISA',
      tier = 'STANDARD',
      spendingLimit = 15000
    } = req.body;

    const cardId = uuidv4();
    const lastFour = Math.floor(1000 + Math.random() * 9000);
    let prefix = '4111';
    const b = brand.toUpperCase();
    if (b === 'MASTERCARD') prefix = '5425';
    else if (b === 'AMEX') prefix = '3782';
    else if (b === 'DISCOVER') prefix = '6011';

    const cardMasked = `${prefix} •••• •••• ${lastFour}`;
    const cvv = String(Math.floor(100 + Math.random() * 900));

    // Expiry 4 years out
    const expDate = new Date();
    expDate.setFullYear(expDate.getFullYear() + 4);
    const expStr = `${String(expDate.getMonth() + 1).padStart(2, '0')}/${String(expDate.getFullYear()).slice(-2)}`;

    await pool.execute(
      `INSERT INTO cards (id, account_id, card_number_masked, card_holder_name, expiry_date, cvv, card_type, tier, brand, spending_limit, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
      [
        cardId,
        accountId,
        cardMasked,
        req.user.fullName.toUpperCase(),
        expStr,
        cvv,
        cardType.toUpperCase(),
        tier.toUpperCase(),
        brand.toUpperCase(),
        spendingLimit
      ]
    );

    return res.status(201).json({
      success: true,
      status: 'SUCCESS',
      message: `New ${tier} ${brand} ${cardType} card issued with instant virtual access.`,
      data: {
        id: cardId,
        cardNumberMasked: cardMasked,
        expiryDate: expStr,
        cvv,
        cardType,
        tier,
        brand,
        spendingLimit,
        status: 'ACTIVE'
      }
    });
  } catch (err) {
    console.error('Error in requestCard:', err);
    return res.status(500).json({
      success: false,
      status: 'SERVER_ERROR',
      message: 'Failed to issue card.'
    });
  }
}

module.exports = {
  listCards,
  toggleCardStatus,
  requestCard
};
