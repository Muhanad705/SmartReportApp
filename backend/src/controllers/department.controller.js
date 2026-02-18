// backend/src/controllers/department.controller.js
const sql = require("mssql");
const poolPromise = require("../../db");

exports.getDepartments = async (req, res) => {
  try {
    const pool = await poolPromise;

    const r = await pool.request().query(`
      SELECT Id, Name, CreatedAt
      FROM Departments
      ORDER BY CreatedAt DESC
    `);

    return res.json(r.recordset);
  } catch (err) {
    console.error("GET DEPARTMENTS ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};
