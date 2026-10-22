const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');
const emailService = require('../services/email.service');
const chatbotService = require('../services/chatbot.service');

// =============================================================================
// 1. PUBLIC CONTACT INQUIRY
// =============================================================================
async function submitContactInquiry(req, res) {
  try {
    const { name, email, phone, subject, message } = req.body;

    if (!name || !email || !subject || !message) {
      return res.status(400).json({
        success: false,
        status: 'REQUIRED_FIELD',
        message: 'Name, Email, Subject, and Message are required fields.'
      });
    }

    const id = uuidv4();
    await pool.execute(
      `INSERT INTO contact_inquiries (id, name, email, phone, subject, message, status)
       VALUES (?, ?, ?, ?, ?, ?, 'NEW')`,
      [
        id,
        name.trim(),
        email.trim().toLowerCase(),
        phone ? phone.trim() : null,
        subject.trim(),
        message.trim()
      ]
    );

    return res.status(201).json({
      success: true,
      status: 'SUCCESS',
      message: 'Thank you for reaching out to Obsidian Trust Bancorp. A corporate relationship manager will review your inquiry shortly.'
    });
  } catch (err) {
    console.error('Error in submitContactInquiry:', err);
    return res.status(500).json({
      success: false,
      status: 'SERVER_ERROR',
      message: 'Failed to dispatch inquiry.'
    });
  }
}

// =============================================================================
// 2. USER SUPPORT DESK TICKETS
// =============================================================================

// Generate unique ticket number: VA-TKT-XXXXXX
function generateTicketNumber() {
  const random = Math.floor(100000 + Math.random() * 900000);
  return `VA-TKT-${random}`;
}

// POST /api/v1/support/tickets (Create Ticket)
async function createTicket(req, res) {
  const conn = await pool.getConnection();
  try {
    const userId = req.user.id;
    const { subject, department = 'GENERAL_SUPPORT', priority = 'MEDIUM', message } = req.body;

    if (!subject || !message) {
      return res.status(400).json({
        success: false,
        message: 'Subject and initial message are required to open a support ticket.'
      });
    }

    await conn.beginTransaction();

    const ticketId = uuidv4();
    const ticketNumber = generateTicketNumber();

    await conn.execute(
      `INSERT INTO support_tickets (id, user_id, ticket_number, subject, department, priority, status)
       VALUES (?, ?, ?, ?, ?, ?, 'OPEN')`,
      [ticketId, userId, ticketNumber, subject.trim(), department, priority]
    );

    const messageId = uuidv4();
    await conn.execute(
      `INSERT INTO support_messages (id, ticket_id, sender_id, sender_role, sender_name, message, is_read)
       VALUES (?, ?, ?, 'USER', ?, ?, FALSE)`,
      [messageId, ticketId, userId, req.user.fullName || 'Client', message.trim()]
    );

    await conn.commit();

    // Asynchronously dispatch Resend email notification
    if (req.user && req.user.email) {
      emailService.sendSupportTicketCreatedAlert({
        to: req.user.email,
        customerName: req.user.fullName || `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || 'Client',
        ticketNumber,
        subject: subject.trim(),
        department,
        priority
      }).catch(err => console.error('[Email Notification Error]:', err));
    }

    return res.status(201).json({
      success: true,
      status: 'SUCCESS',
      message: `Support ticket ${ticketNumber} created successfully. Our executive help desk has been notified.`,
      data: {
        ticketId,
        ticketNumber,
        subject,
        department,
        priority,
        status: 'OPEN'
      }
    });
  } catch (err) {
    await conn.rollback();
    console.error('Error creating ticket:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to create support ticket. Please try again.'
    });
  } finally {
    conn.release();
  }
}

// POST /api/v1/support/email-admin (User sends direct support email to administration)
async function sendSupportEmailToAdmin(req, res) {
  const conn = await pool.getConnection();
  try {
    const userId = req.user.id;
    const { subject, department = 'GENERAL_SUPPORT', priority = 'MEDIUM', message } = req.body;

    if (!subject || !message) {
      return res.status(400).json({
        success: false,
        message: 'Subject and message are required to dispatch a support email.'
      });
    }

    // Get user's primary account details
    const [accounts] = await pool.execute(
      `SELECT account_number, currency, available_balance FROM accounts WHERE user_id = ? LIMIT 1`,
      [userId]
    );
    const account = accounts[0] || {};
    const customerName = req.user.fullName || `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || 'Client';

    await conn.beginTransaction();

    const ticketId = uuidv4();
    const ticketNumber = generateTicketNumber();

    await conn.execute(
      `INSERT INTO support_tickets (id, user_id, ticket_number, subject, department, priority, status)
       VALUES (?, ?, ?, ?, ?, ?, 'OPEN')`,
      [ticketId, userId, ticketNumber, subject.trim(), department, priority]
    );

    const messageId = uuidv4();
    await conn.execute(
      `INSERT INTO support_messages (id, ticket_id, sender_id, sender_role, sender_name, message, is_read)
       VALUES (?, ?, ?, 'USER', ?, ?, FALSE)`,
      [messageId, ticketId, userId, customerName, message.trim()]
    );

    await conn.commit();

    // Dispatch direct email to admin via Resend
    const emailResult = await emailService.sendUserToAdminSupportEmail({
      fromUser: req.user,
      customerName,
      accountNumber: account.account_number || 'N/A',
      subject: subject.trim(),
      department,
      priority,
      message: message.trim(),
      ticketNumber
    });

    // Also dispatch confirmation alert to customer
    if (req.user.email) {
      emailService.sendSupportTicketCreatedAlert({
        to: req.user.email,
        customerName,
        ticketNumber,
        subject: subject.trim(),
        department,
        priority
      }).catch(err => console.error('[Customer Email Confirmation Error]:', err));
    }

    return res.status(200).json({
      success: true,
      status: 'DISPATCHED',
      message: emailResult.simulated 
        ? `Support inquiry registered under ${ticketNumber}. Your inquiry has been routed to executive administration.`
        : `Support email successfully dispatched via Resend to Executive Administration. Docket: ${ticketNumber}`,
      data: {
        ticketId,
        ticketNumber,
        emailResult
      }
    });
  } catch (err) {
    await conn.rollback();
    console.error('Error in sendSupportEmailToAdmin:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to dispatch support email. Please try again.'
    });
  } finally {
    conn.release();
  }
}

// GET /api/v1/support/tickets (List user tickets)
async function listUserTickets(req, res) {
  try {
    const userId = req.user.id;

    const [tickets] = await pool.execute(
      `SELECT t.*, 
              (SELECT message FROM support_messages WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1) as latest_message,
              (SELECT created_at FROM support_messages WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1) as latest_message_time,
              (SELECT COUNT(*) FROM support_messages WHERE ticket_id = t.id) as message_count,
              (SELECT COUNT(*) FROM support_messages WHERE ticket_id = t.id AND sender_role = 'ADMIN' AND is_read = FALSE) as unread_admin_replies
       FROM support_tickets t
       WHERE t.user_id = ?
       ORDER BY t.updated_at DESC`,
      [userId]
    );

    return res.json({
      success: true,
      data: tickets
    });
  } catch (err) {
    console.error('Error listing user tickets:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve support tickets.'
    });
  }
}

// GET /api/v1/support/tickets/:id (Get ticket details with full messages)
async function getTicketDetails(req, res) {
  try {
    const userId = req.user.id;
    const ticketId = req.params.id;

    const [tickets] = await pool.execute(
      `SELECT * FROM support_tickets WHERE id = ? AND (user_id = ? OR ? = 'ADMIN')`,
      [ticketId, userId, req.user.role || 'CUSTOMER']
    );

    if (tickets.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found or access denied.'
      });
    }

    const ticket = tickets[0];

    // Mark admin messages as read if customer is viewing
    if (req.user.role !== 'ADMIN') {
      await pool.execute(
        `UPDATE support_messages SET is_read = TRUE WHERE ticket_id = ? AND sender_role = 'ADMIN'`,
        [ticketId]
      );
    }

    // Retrieve all messages in thread
    const [messages] = await pool.execute(
      `SELECT * FROM support_messages WHERE ticket_id = ? ORDER BY created_at ASC`,
      [ticketId]
    );

    return res.json({
      success: true,
      data: {
        ticket,
        messages
      }
    });
  } catch (err) {
    console.error('Error getting ticket details:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve ticket conversation.'
    });
  }
}

// POST /api/v1/support/tickets/:id/messages (User replies to ticket)
async function sendTicketMessage(req, res) {
  try {
    const userId = req.user.id;
    const ticketId = req.params.id;
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Message body cannot be empty.'
      });
    }

    // Verify ticket ownership
    const [tickets] = await pool.execute(
      `SELECT * FROM support_tickets WHERE id = ? AND user_id = ?`,
      [ticketId, userId]
    );

    if (tickets.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found.'
      });
    }

    const messageId = uuidv4();
    await pool.execute(
      `INSERT INTO support_messages (id, ticket_id, sender_id, sender_role, sender_name, message, is_read)
       VALUES (?, ?, ?, 'USER', ?, ?, FALSE)`,
      [messageId, ticketId, userId, req.user.fullName || 'Client', message.trim()]
    );

    // Reopen ticket if it was resolved/awaiting
    await pool.execute(
      `UPDATE support_tickets SET status = 'OPEN', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [ticketId]
    );

    return res.status(201).json({
      success: true,
      message: 'Reply sent successfully.',
      data: {
        id: messageId,
        ticket_id: ticketId,
        sender_role: 'USER',
        sender_name: req.user.fullName || 'Client',
        message: message.trim(),
        created_at: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('Error sending ticket message:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to send reply.'
    });
  }
}

// PATCH /api/v1/support/tickets/:id/close (User closes ticket)
async function closeTicket(req, res) {
  try {
    const userId = req.user.id;
    const ticketId = req.params.id;

    await pool.execute(
      `UPDATE support_tickets SET status = 'RESOLVED', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`,
      [ticketId, userId]
    );

    return res.json({
      success: true,
      message: 'Support ticket marked as resolved.'
    });
  } catch (err) {
    console.error('Error closing ticket:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to update ticket status.'
    });
  }
}

// =============================================================================
// 3. AI CHATBOT ASSISTANT ("VaultBot / Chatpot")
// =============================================================================
async function chatbotQuery(req, res) {
  try {
    const { query } = req.body;
    const user = req.user;

    if (!query || !query.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Query cannot be empty.'
      });
    }

    const response = await chatbotService.getChatbotResponse(user.id, query.trim());

    return res.json({
      success: true,
      data: {
        reply: response.reply,
        category: response.category || 'GENERAL',
        suggestedActions: response.suggestedActions || [],
        canEscalateToHuman: response.canEscalateToHuman || false,
        timestamp: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('Error in chatbotQuery:', err);
    return res.status(500).json({
      success: false,
      message: 'Assistant service temporarily unavailable.'
    });
  }
}


// =============================================================================
// 4. ADMIN SUPPORT DESK & DIRECT REPLIES
// =============================================================================

// GET /api/v1/admin/support/tickets (Admin lists all user tickets)
async function listAdminTickets(req, res) {
  try {
    const { status, search } = req.query;

    let queryStr = `
      SELECT t.*, 
             CONCAT(u.first_name, ' ', u.last_name) as customer_name,
             u.email as customer_email,
             u.phone as customer_phone,
             u.kyc_status as customer_kyc_status,
             a.account_number as customer_account_number,
             a.available_balance as customer_balance,
             a.currency as customer_currency,
             (SELECT message FROM support_messages WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1) as latest_message,
             (SELECT created_at FROM support_messages WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1) as latest_message_time,
             (SELECT sender_role FROM support_messages WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1) as latest_sender_role,
             (SELECT COUNT(*) FROM support_messages WHERE ticket_id = t.id) as message_count,
             (SELECT COUNT(*) FROM support_messages WHERE ticket_id = t.id AND sender_role = 'USER' AND is_read = FALSE) as unread_user_messages
      FROM support_tickets t
      JOIN users u ON t.user_id = u.id
      LEFT JOIN accounts a ON u.id = a.user_id
      WHERE 1=1
    `;

    const params = [];

    if (status && status !== 'ALL') {
      queryStr += ` AND t.status = ?`;
      params.push(status);
    }

    if (search && search.trim()) {
      queryStr += ` AND (t.ticket_number LIKE ? OR t.subject LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ? OR a.account_number LIKE ?)`;
      const kw = `%${search.trim()}%`;
      params.push(kw, kw, kw, kw, kw, kw);
    }

    queryStr += ` ORDER BY unread_user_messages DESC, t.updated_at DESC`;

    const [tickets] = await pool.execute(queryStr, params);

    return res.json({
      success: true,
      data: tickets
    });
  } catch (err) {
    console.error('Error in listAdminTickets:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve administrative support tickets.'
    });
  }
}

// GET /api/v1/admin/support/tickets/:id (Admin views specific ticket and thread)
async function getAdminTicketDetails(req, res) {
  try {
    const ticketId = req.params.id;

    const [tickets] = await pool.execute(
      `SELECT t.*,
              u.id as user_id,
              CONCAT(u.first_name, ' ', u.last_name) as customer_name,
              u.email as customer_email,
              u.phone as customer_phone,
              u.kyc_status as customer_kyc_status,
              a.account_number as customer_account_number,
              a.available_balance as customer_balance,
              a.currency as customer_currency,
              a.status as account_status
       FROM support_tickets t
       JOIN users u ON t.user_id = u.id
       LEFT JOIN accounts a ON u.id = a.user_id
       WHERE t.id = ?`,
      [ticketId]
    );

    if (tickets.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found.'
      });
    }

    const ticket = tickets[0];

    // Mark user messages as read when viewed by admin
    await pool.execute(
      `UPDATE support_messages SET is_read = TRUE WHERE ticket_id = ? AND sender_role = 'USER'`,
      [ticketId]
    );

    // Get thread messages
    const [messages] = await pool.execute(
      `SELECT * FROM support_messages WHERE ticket_id = ? ORDER BY created_at ASC`,
      [ticketId]
    );

    return res.json({
      success: true,
      data: {
        ticket,
        messages
      }
    });
  } catch (err) {
    console.error('Error in getAdminTicketDetails:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve ticket conversation.'
    });
  }
}

// POST /api/v1/admin/support/tickets/:id/reply (Admin directly replies to user)
async function replyAdminTicket(req, res) {
  try {
    const ticketId = req.params.id;
    const adminUser = req.user;
    const { message, status = 'IN_PROGRESS' } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Reply message cannot be empty.'
      });
    }

    // Verify ticket exists
    const [tickets] = await pool.execute(
      `SELECT * FROM support_tickets WHERE id = ?`,
      [ticketId]
    );

    if (tickets.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found.'
      });
    }

    const messageId = uuidv4();
    const adminName = adminUser.fullName || 'Obsidian Trust Bancorp Support Officer';

    await pool.execute(
      `INSERT INTO support_messages (id, ticket_id, sender_id, sender_role, sender_name, message, is_read)
       VALUES (?, ?, ?, 'ADMIN', ?, ?, FALSE)`,
      [messageId, ticketId, adminUser.id, adminName, message.trim()]
    );

    // Update ticket status
    await pool.execute(
      `UPDATE support_tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, ticketId]
    );

    // Asynchronously dispatch Resend email to client
    (async () => {
      try {
        const [ticketUsers] = await pool.execute(
          `SELECT u.email, CONCAT(u.first_name, ' ', u.last_name) as full_name, t.ticket_number, t.subject
           FROM support_tickets t
           JOIN users u ON t.user_id = u.id
           WHERE t.id = ?`,
          [ticketId]
        );
        if (ticketUsers.length > 0 && ticketUsers[0].email) {
          await emailService.sendSupportTicketReplyAlert({
            to: ticketUsers[0].email,
            customerName: ticketUsers[0].full_name,
            ticketNumber: ticketUsers[0].ticket_number,
            subject: ticketUsers[0].subject,
            officerName: adminName,
            replyMessage: message.trim()
          });
        }
      } catch (e) {
        console.error('[Email Reply Notification Error]:', e);
      }
    })();

    return res.status(201).json({
      success: true,
      message: 'Admin response dispatched to customer dashboard.',
      data: {
        id: messageId,
        ticket_id: ticketId,
        sender_role: 'ADMIN',
        sender_name: adminName,
        message: message.trim(),
        created_at: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('Error in replyAdminTicket:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to submit admin reply.'
    });
  }
}

// PATCH /api/v1/admin/support/tickets/:id/status (Admin updates status)
async function updateAdminTicketStatus(req, res) {
  try {
    const ticketId = req.params.id;
    const { status } = req.body;

    const validStatuses = ['OPEN', 'IN_PROGRESS', 'AWAITING_USER', 'RESOLVED', 'CLOSED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value.'
      });
    }

    await pool.execute(
      `UPDATE support_tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, ticketId]
    );

    return res.json({
      success: true,
      message: `Ticket status successfully changed to ${status}.`
    });
  } catch (err) {
    console.error('Error in updateAdminTicketStatus:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to update ticket status.'
    });
  }
}

module.exports = {
  submitContactInquiry,
  createTicket,
  sendSupportEmailToAdmin,
  listUserTickets,
  getTicketDetails,
  sendTicketMessage,
  closeTicket,
  chatbotQuery,
  listAdminTickets,
  getAdminTicketDetails,
  replyAdminTicket,
  updateAdminTicketStatus
};
