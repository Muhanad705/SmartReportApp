// backend/src/controllers/employee.controller.js
const sql = require("mssql");
const poolPromise = require("../../db");

// ---------- Helpers ----------
function isGuid(v) {
  const s = String(v || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}
function normStatus(v) {
  return String(v || "").trim().toLowerCase();
}
function getDeptId(req) {
  const deptId = String(req.user?.departmentId || "").trim();
  return isGuid(deptId) ? deptId : null;
}
function getUserId(req) {
  const uid = String(req.user?.userId || "").trim();
  return isGuid(uid) ? uid : null;
}

const ALLOWED_STATUS = new Set(["in_progress", "accepted", "rejected"]);

async function insertNotification(tx, { userId, reportId, type, title, message }) {
  try {
    const uid = String(userId || "").trim();
    const rid = String(reportId || "").trim();
    if (!isGuid(uid)) return;

    const req = new sql.Request(tx);
    req.input("UserId", sql.UniqueIdentifier, uid);
    req.input("ReportId", sql.UniqueIdentifier, isGuid(rid) ? rid : null);
    req.input("Type", sql.NVarChar(30), String(type || "info"));
    req.input("Title", sql.NVarChar(150), String(title || ""));
    req.input("Message", sql.NVarChar(sql.MAX), String(message || ""));

    await req.query(`
      INSERT INTO dbo.Notifications (Id, UserId, ReportId, Type, Title, Message, IsRead, CreatedAt)
      VALUES (NEWID(), @UserId, @ReportId, @Type, @Title, @Message, 0, SYSDATETIME())
    `);
  } catch (e) {
    // ما نوقف العملية لو الإشعار فشل
    console.log("EMPLOYEE insertNotification skipped:", e?.message);
  }
}

// ---------- Reports ----------
exports.listReports = async (req, res) => {
  try {
    const deptId = getDeptId(req);
    if (!deptId) return res.status(400).json({ message: "departmentId missing/invalid in token" });

    const status = normStatus(req.query.status || "");
    const pool = await poolPromise;

    const r = await pool
      .request()
      .input("DepartmentId", sql.UniqueIdentifier, deptId)
      .input("Status", sql.NVarChar(50), status)
      .query(`
        SELECT
          r.Id, r.UserId, r.DepartmentId, r.Description, r.Status, r.CreatedAt, r.UpdatedAt,
          u.FullName AS ReporterName, u.Phone AS ReporterPhone
        FROM dbo.Reports r
        INNER JOIN dbo.UsersProfile u ON u.UserId = r.UserId
        WHERE r.DepartmentId = @DepartmentId
          AND (@Status = '' OR LOWER(LTRIM(RTRIM(r.Status))) = LOWER(LTRIM(RTRIM(@Status))))
        ORDER BY r.CreatedAt DESC
      `);

    return res.json({ items: r.recordset || [] });
  } catch (err) {
    console.error("EMPLOYEE listReports ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};

exports.getReportDetails = async (req, res) => {
  try {
    const deptId = getDeptId(req);
    const reportId = String(req.params.id || "").trim();

    if (!deptId) return res.status(400).json({ message: "departmentId missing/invalid in token" });
    if (!isGuid(reportId)) return res.status(400).json({ message: "Invalid report id" });

    const pool = await poolPromise;

    const reportR = await pool
      .request()
      .input("ReportId", sql.UniqueIdentifier, reportId)
      .input("DepartmentId", sql.UniqueIdentifier, deptId)
      .query(`
        SELECT TOP 1
          r.*,
          u.FullName AS ReporterName,
          u.Phone AS ReporterPhone,
          u.Email AS ReporterEmail
        FROM dbo.Reports r
        INNER JOIN dbo.UsersProfile u ON u.UserId = r.UserId
        WHERE r.Id = @ReportId AND r.DepartmentId = @DepartmentId
      `);

    if (!reportR.recordset?.length)
      return res.status(404).json({ message: "البلاغ غير موجود ضمن جهتك" });

    const mediaR = await pool
      .request()
      .input("ReportId", sql.UniqueIdentifier, reportId)
      .query(`
        SELECT Id, ReportId, Type, FileUrl, CreatedAt
        FROM dbo.Media
        WHERE ReportId = @ReportId
        ORDER BY CreatedAt DESC
      `);

    // ✅ سجل تغيير الحالة مع اسم اللي غيّرها
    const historyR = await pool
      .request()
      .input("ReportId", sql.UniqueIdentifier, reportId)
      .query(`
        SELECT
          h.Id,
          h.ReportId,
          h.ChangedBy,
          h.FromStatus,
          h.ToStatus,
          h.ChangedAt,
          up.FullName AS ChangedByName
        FROM dbo.ReportStatusHistory h
        LEFT JOIN dbo.UsersProfile up ON up.UserId = h.ChangedBy
        WHERE h.ReportId = @ReportId
        ORDER BY h.ChangedAt DESC
      `);

    return res.json({
      report: reportR.recordset[0],
      media: mediaR.recordset || [],
      history: historyR.recordset || [],
    });
  } catch (err) {
    console.error("EMPLOYEE getReportDetails ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};

exports.updateReportStatus = async (req, res) => {
  let tx;
  try {
    const deptId = getDeptId(req);
    const employeeId = getUserId(req);
    const reportId = String(req.params.id || "").trim();
    const nextStatus = normStatus(req.body?.status);

    if (!deptId) return res.status(400).json({ message: "departmentId missing/invalid in token" });
    if (!employeeId) return res.status(400).json({ message: "Invalid employee userId in token" });
    if (!isGuid(reportId)) return res.status(400).json({ message: "Invalid report id" });
    if (!ALLOWED_STATUS.has(nextStatus)) return res.status(400).json({ message: "Status غير صحيح" });

    const pool = await poolPromise;
    tx = new sql.Transaction(pool);
    await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

    const r0 = await new sql.Request(tx)
      .input("Id", sql.UniqueIdentifier, reportId)
      .input("DepartmentId", sql.UniqueIdentifier, deptId)
      .query(`
        SELECT TOP 1 Id, Status, UserId
        FROM dbo.Reports
        WHERE Id = @Id AND DepartmentId = @DepartmentId
      `);

    const row = r0.recordset?.[0];
    if (!row) {
      await tx.rollback();
      return res.status(404).json({ message: "البلاغ غير موجود ضمن جهتك" });
    }

    const oldStatus = normStatus(row.Status);
    const ownerId = row.UserId ? String(row.UserId) : null;

    if (oldStatus === nextStatus) {
      await tx.rollback();
      return res.json({ message: "الحالة نفسها (لا يوجد تغيير)" });
    }

    await new sql.Request(tx)
      .input("Id", sql.UniqueIdentifier, reportId)
      .input("Status", sql.NVarChar(20), nextStatus)
      .input("UpdatedBy", sql.UniqueIdentifier, employeeId)
      .query(`
        UPDATE dbo.Reports
        SET Status = @Status, UpdatedAt = SYSDATETIME(), UpdatedBy = @UpdatedBy
        WHERE Id = @Id
      `);

    // ✅ history بدون Note نهائيًا (عشان ما يرجع خطأ/قيود)
    await new sql.Request(tx)
      .input("ReportId", sql.UniqueIdentifier, reportId)
      .input("ChangedBy", sql.UniqueIdentifier, employeeId)
      .input("FromStatus", sql.NVarChar(20), oldStatus)
      .input("ToStatus", sql.NVarChar(20), nextStatus)
      .query(`
        INSERT INTO dbo.ReportStatusHistory (Id, ReportId, ChangedBy, FromStatus, ToStatus, ChangedAt)
        VALUES (NEWID(), @ReportId, @ChangedBy, @FromStatus, @ToStatus, SYSDATETIME())
      `);

    // notification to owner
    if (ownerId && isGuid(ownerId)) {
      let title = "تحديث حالة البلاغ";
      let message = "تم تحديث حالة البلاغ";

      if (nextStatus === "accepted") {
        title = "تم حل البلاغ ✅";
        message = "تمت معالجة البلاغ بنجاح";
      } else if (nextStatus === "rejected") {
        title = "تم رفض البلاغ ❌";
        message = "تم رفض البلاغ من الجهة المختصة";
      } else if (nextStatus === "in_progress") {
        title = "جاري معالجة البلاغ ⏳";
        message = "تم البدء في معالجة البلاغ";
      }

      await insertNotification(tx, {
        userId: ownerId,
        reportId,
        type: "status_changed",
        title,
        message,
      });
    }

    await tx.commit();
    return res.json({ message: "تم تحديث الحالة" });
  } catch (err) {
    try {
      if (tx) await tx.rollback();
    } catch {}
    console.error("EMPLOYEE updateReportStatus ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};

// ---------- Stats ----------
exports.getStats = async (req, res) => {
  try {
    const deptId = getDeptId(req);
    if (!deptId) return res.status(400).json({ message: "departmentId missing/invalid in token" });

    const pool = await poolPromise;

    const r = await pool
      .request()
      .input("DepartmentId", sql.UniqueIdentifier, deptId)
      .query(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN LOWER(LTRIM(RTRIM(Status))) = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
          SUM(CASE WHEN LOWER(LTRIM(RTRIM(Status))) = 'accepted' THEN 1 ELSE 0 END) AS accepted,
          SUM(CASE WHEN LOWER(LTRIM(RTRIM(Status))) = 'rejected' THEN 1 ELSE 0 END) AS rejected
        FROM dbo.Reports
        WHERE DepartmentId = @DepartmentId
      `);

    return res.json({
      stats: r.recordset?.[0] || { total: 0, in_progress: 0, accepted: 0, rejected: 0 },
    });
  } catch (err) {
    console.error("EMPLOYEE getStats ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};