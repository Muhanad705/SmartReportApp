const bcrypt = require("bcryptjs");
const sql = require("mssql");
const poolPromise = require("../../db"); // ← إذا مسارك مختلف قلّي وعدّله

function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(v || "").trim());
}
function cleanPhone(v) {
  return String(v || "").replace(/[^\d]/g, "");
}

exports.listEmployees = async (req, res) => {
  try {
    const deptId = req.user?.departmentId;
    if (!deptId) return res.status(400).json({ message: "Manager has no departmentId" });

    const pool = await poolPromise;

    const r = await pool.request()
      .input("DepartmentId", sql.Int, deptId)
      .query(`
        SELECT UserId, FullName, Phone, Email, Role, DepartmentId, IsActive, CreatedAt
        FROM UsersProfile
        WHERE DepartmentId = @DepartmentId AND Role = 'employee'
        ORDER BY CreatedAt DESC
      `);

    return res.json({ items: r.recordset });
  } catch (err) {
    console.error("MANAGER listEmployees ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};

exports.createEmployee = async (req, res) => {
  try {
    const deptId = req.user?.departmentId;
    if (!deptId) return res.status(400).json({ message: "Manager has no departmentId" });

    const { fullName, email, phone, nationalId, password } = req.body || {};
    const name = String(fullName || "").trim();
    const em = String(email || "").trim().toLowerCase();
    const ph = cleanPhone(phone);
    const nid = String(nationalId || "").replace(/[^\d]/g, "");
    const pw = String(password || "");

    if (name.length < 3) return res.status(400).json({ message: "الاسم غير صحيح" });
    if (!isEmail(em)) return res.status(400).json({ message: "البريد غير صحيح" });
    if (!ph) return res.status(400).json({ message: "رقم الجوال مطلوب" });
    if (pw.length < 6) return res.status(400).json({ message: "كلمة المرور لازم 6 أحرف+" });

    const pool = await poolPromise;

    // منع تكرار البريد/الجوال/الهوية
    const exists = await pool.request()
      .input("Email", sql.NVarChar(150), em)
      .input("Phone", sql.NVarChar(50), ph)
      .input("NationalId", sql.NVarChar(50), nid)
      .query(`
        SELECT TOP 1 UserId
        FROM UsersProfile
        WHERE Email = @Email OR Phone = @Phone OR (LTRIM(RTRIM(@NationalId)) <> '' AND NationalId = @NationalId)
      `);

    if (exists.recordset?.length)
      return res.status(409).json({ message: "الموظف موجود مسبقًا (بريد/جوال/هوية)" });

    const hash = await bcrypt.hash(pw, 10);

    const ins = await pool.request()
      .input("FullName", sql.NVarChar(200), name)
      .input("Email", sql.NVarChar(150), em)
      .input("Phone", sql.NVarChar(50), ph)
      .input("NationalId", sql.NVarChar(50), nid)
      .input("PasswordHash", sql.NVarChar(250), hash)
      .input("DepartmentId", sql.Int, deptId)
      .query(`
        INSERT INTO UsersProfile
          (FullName, Phone, Role, DepartmentId, IsActive, CreatedAt, Email, NationalId, PasswordHash)
        OUTPUT INSERTED.UserId, INSERTED.FullName, INSERTED.Phone, INSERTED.Email,
               INSERTED.Role, INSERTED.DepartmentId, INSERTED.IsActive, INSERTED.CreatedAt
        VALUES
          (@FullName, @Phone, 'employee', @DepartmentId, 1, GETDATE(), @Email, @NationalId, @PasswordHash)
      `);

    return res.status(201).json({ item: ins.recordset?.[0] });
  } catch (err) {
    console.error("MANAGER createEmployee ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};

exports.disableEmployee = async (req, res) => {
  try {
    const deptId = req.user?.departmentId;
    const userId = parseInt(req.params.userId, 10);

    if (!deptId) return res.status(400).json({ message: "Manager has no departmentId" });
    if (!userId) return res.status(400).json({ message: "Invalid userId" });

    const pool = await poolPromise;

    const r = await pool.request()
      .input("UserId", sql.Int, userId)
      .input("DepartmentId", sql.Int, deptId)
      .query(`
        UPDATE UsersProfile
        SET IsActive = 0
        WHERE UserId = @UserId AND DepartmentId = @DepartmentId AND Role = 'employee';

        SELECT @@ROWCOUNT AS affected;
      `);

    if (!r.recordset?.[0]?.affected)
      return res.status(404).json({ message: "موظف غير موجود ضمن جهتك" });

    return res.json({ message: "تم إيقاف الموظف" });
  } catch (err) {
    console.error("MANAGER disableEmployee ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};

exports.listReports = async (req, res) => {
  try {
    const deptId = req.user?.departmentId;
    if (!deptId) return res.status(400).json({ message: "Manager has no departmentId" });

    const status = String(req.query.status || "").trim(); // accepted / rejected / in_progress ...
    const pool = await poolPromise;

    const r = await pool.request()
      .input("DepartmentId", sql.Int, deptId)
      .input("Status", sql.NVarChar(50), status)
      .query(`
        SELECT r.Id, r.UserId, r.DepartmentId, r.Description, r.Status, r.CreatedAt, r.UpdatedAt,
               u.FullName AS ReporterName, u.Phone AS ReporterPhone
        FROM Reports r
        INNER JOIN UsersProfile u ON u.UserId = r.UserId
        WHERE r.DepartmentId = @DepartmentId
          AND (@Status = '' OR r.Status = @Status)
        ORDER BY r.CreatedAt DESC
      `);

    return res.json({ items: r.recordset });
  } catch (err) {
    console.error("MANAGER listReports ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};

exports.getReportDetails = async (req, res) => {
  try {
    const deptId = req.user?.departmentId;
    const reportId = parseInt(req.params.id, 10);

    if (!deptId) return res.status(400).json({ message: "Manager has no departmentId" });
    if (!reportId) return res.status(400).json({ message: "Invalid report id" });

    const pool = await poolPromise;

    const reportR = await pool.request()
      .input("ReportId", sql.Int, reportId)
      .input("DepartmentId", sql.Int, deptId)
      .query(`
        SELECT TOP 1
          r.*, u.FullName AS ReporterName, u.Phone AS ReporterPhone, u.Email AS ReporterEmail
        FROM Reports r
        INNER JOIN UsersProfile u ON u.UserId = r.UserId
        WHERE r.Id = @ReportId AND r.DepartmentId = @DepartmentId
      `);

    if (!reportR.recordset?.length)
      return res.status(404).json({ message: "البلاغ غير موجود ضمن جهتك" });

    const mediaR = await pool.request()
      .input("ReportId", sql.Int, reportId)
      .query(`
        SELECT Id, ReportId, Type, FileUrl, CreatedAt
        FROM Media
        WHERE ReportId = @ReportId
        ORDER BY CreatedAt DESC
      `);

    const historyR = await pool.request()
      .input("ReportId", sql.Int, reportId)
      .query(`
        SELECT h.Id, h.ReportId, h.ChangedBy, h.FromStatus, h.ToStatus, h.Note, h.ChangedAt,
               up.FullName AS ChangedByName
        FROM ReportStatusHistory h
        LEFT JOIN UsersProfile up ON up.UserId = h.ChangedBy
        WHERE h.ReportId = @ReportId
        ORDER BY h.ChangedAt DESC
      `);

    return res.json({
      report: reportR.recordset[0],
      media: mediaR.recordset,
      history: historyR.recordset,
    });
  } catch (err) {
    console.error("MANAGER getReportDetails ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};

exports.getStats = async (req, res) => {
  try {
    const deptId = req.user?.departmentId;
    if (!deptId) return res.status(400).json({ message: "Manager has no departmentId" });

    const pool = await poolPromise;

    const r = await pool.request()
      .input("DepartmentId", sql.Int, deptId)
      .query(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN Status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
          SUM(CASE WHEN Status = 'accepted' THEN 1 ELSE 0 END) AS accepted,
          SUM(CASE WHEN Status = 'rejected' THEN 1 ELSE 0 END) AS rejected
        FROM Reports
        WHERE DepartmentId = @DepartmentId
      `);

    return res.json({ stats: r.recordset?.[0] || { total: 0, in_progress: 0, accepted: 0, rejected: 0 } });
  } catch (err) {
    console.error("MANAGER getStats ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};