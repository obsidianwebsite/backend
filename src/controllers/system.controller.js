const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');

// GET /api/v1/system/settings (Public / Client)
async function getSettings(req, res) {
  try {
    const [rows] = await pool.execute(
      `SELECT * FROM system_settings WHERE id = 'main_settings' LIMIT 1`
    );

    if (rows.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          id: 'main_settings',
          site_name: 'Obsidian Trust Bancorp Plc',
          site_tagline: 'Commercial Banking & Institutional Treasury',
          site_logo_url: '',
          contact_email: 'support@obsidiantrustbancorp.com',
          admin_notification_email: 'admin@obsidiantrustbancorp.com',
          phone_number: '+44 20 7946 0912',
          address: '12 Bridlesmith Walk, Nottingham, NG1 2HB, United Kingdom',
          swift_code: 'OTBCGB2L',
          routing_number: '026009593',
          currency_code: 'USD',
          currency_symbol: '$',
          about_summary: 'Obsidian Trust Bancorp Plc is an authorized and regulated British-Atlantic commercial banking and institutional treasury corporation.',
          copyright_text: '© 2026 Obsidian Trust Bancorp Plc. Authorized & Regulated Commercial Banking Institution.',
          support_hours: '24/7 Global Treasury Support Desk',
          is_setup_completed: true
        }
      });
    }

    return res.status(200).json({
      success: true,
      data: rows[0]
    });
  } catch (err) {
    console.error('Error fetching system settings:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve system settings.'
    });
  }
}

// PUT /api/v1/admin/system/settings (Admin Protected)
async function updateSettings(req, res) {
  try {
    const adminUser = req.user;
    const {
      site_name,
      site_tagline,
      site_logo_url,
      site_favicon_url,
      contact_email,
      admin_notification_email,
      phone_number,
      address,
      swift_code,
      routing_number,
      currency_code,
      currency_symbol,
      about_summary,
      copyright_text,
      support_hours,
      is_setup_completed
    } = req.body;

    if (!site_name || !contact_email) {
      return res.status(400).json({
        success: false,
        message: 'Website Name and Contact Email are required fields.'
      });
    }

    await pool.execute(
      `INSERT INTO system_settings (
        id, site_name, site_tagline, site_logo_url, site_favicon_url,
        contact_email, admin_notification_email, phone_number, address,
        swift_code, routing_number, currency_code, currency_symbol,
        about_summary, copyright_text, support_hours, is_setup_completed
      ) VALUES (
        'main_settings', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      ) ON DUPLICATE KEY UPDATE
        site_name = VALUES(site_name),
        site_tagline = VALUES(site_tagline),
        site_logo_url = VALUES(site_logo_url),
        site_favicon_url = VALUES(site_favicon_url),
        contact_email = VALUES(contact_email),
        admin_notification_email = VALUES(admin_notification_email),
        phone_number = VALUES(phone_number),
        address = VALUES(address),
        swift_code = VALUES(swift_code),
        routing_number = VALUES(routing_number),
        currency_code = VALUES(currency_code),
        currency_symbol = VALUES(currency_symbol),
        about_summary = VALUES(about_summary),
        copyright_text = VALUES(copyright_text),
        support_hours = VALUES(support_hours),
        is_setup_completed = VALUES(is_setup_completed)`,
      [
        site_name.trim(),
        site_tagline ? site_tagline.trim() : 'Commercial Banking & Institutional Treasury',
        site_logo_url ? site_logo_url.trim() : '',
        site_favicon_url ? site_favicon_url.trim() : '',
        contact_email.trim().toLowerCase(),
        admin_notification_email ? admin_notification_email.trim().toLowerCase() : 'admin@obsidiantrustbancorp.com',
        phone_number ? phone_number.trim() : '+44 20 7946 0912',
        address ? address.trim() : '12 Bridlesmith Walk, Nottingham, NG1 2HB, United Kingdom',
        swift_code ? swift_code.trim().toUpperCase() : 'OTBCGB2L',
        routing_number ? routing_number.trim() : '026009593',
        currency_code ? currency_code.trim().toUpperCase() : 'USD',
        currency_symbol ? currency_symbol.trim() : '$',
        about_summary ? about_summary.trim() : '',
        copyright_text ? copyright_text.trim() : `© 2026 ${site_name.trim()}. Authorized & Regulated Commercial Banking Institution.`,
        support_hours ? support_hours.trim() : '24/7 Global Treasury Support Desk',
        is_setup_completed === false ? 0 : 1
      ]
    );

    // Keep process.env in sync dynamically for email service
    if (admin_notification_email) {
      process.env.ADMIN_NOTIFICATION_EMAIL = admin_notification_email.trim().toLowerCase();
    }

    // Write audit log
    try {
      const logId = uuidv4();
      await pool.execute(
        `INSERT INTO audit_logs (id, user_id, event_type, ip_address, user_agent, metadata) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          logId,
          adminUser.id,
          'SYSTEM_SETTINGS_UPDATED',
          req.ip || '127.0.0.1',
          req.headers['user-agent'] || 'ObsidianTrustBancorp-Admin',
          JSON.stringify({
            updatedBy: adminUser.email,
            site_name: site_name.trim(),
            admin_notification_email: admin_notification_email?.trim(),
            timestamp: new Date().toISOString()
          })
        ]
      );
    } catch (auditErr) {
      console.warn('Could not write audit log for settings update:', auditErr.message);
    }

    const [updatedRows] = await pool.execute(
      `SELECT * FROM system_settings WHERE id = 'main_settings' LIMIT 1`
    );

    return res.status(200).json({
      success: true,
      message: 'Institutional system settings and branding saved successfully.',
      data: updatedRows[0]
    });
  } catch (err) {
    console.error('Error updating system settings:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to update system settings.'
    });
  }
}

module.exports = {
  getSettings,
  updateSettings
};
