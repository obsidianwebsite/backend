const pool = require('../config/db');

// List financial education & academy resources
async function listCourses(req, res) {
  try {
    const { category } = req.query;
    let query = `SELECT * FROM academy_courses`;
    const params = [];
    if (category) {
      query += ` WHERE category = ?`;
      params.push(category);
    }
    query += ` ORDER BY duration_mins ASC`;

    const [courses] = await pool.execute(query, params);
    return res.status(200).json({ success: true, data: courses });
  } catch (err) {
    console.error('Error in listCourses:', err);
    return res.status(500).json({ success: false, message: 'Failed to list academy courses.' });
  }
}

module.exports = {
  listCourses
};
