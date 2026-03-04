// backend/src/controllers/manager.controller.js
const bcrypt = require("bcryptjs");
const sql = require("mssql");
const poolPromise = require("../../db");


function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(v || "").trim());
}
function cleanPhone(v) {
  return String(v || "").replace(/[^\d]/g, "");
}
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
function normStr(v) {
  return String(v || "").trim();
}
function normBool01(v) {
  // يقبل true/false, 1/0, "1"/"0", "true"/"false"
  if (v === true || v === 1 || v === "1" || String(v).toLowerCase() === "true") return 1;
  if (v === false || v === 0 || v === "0" || String(v).toLowerCase() === "false") return 0;
  return null;
}

const ALLOWED_STATUS = new Set(["in_progress", "accepted", "rejected"]);


async function insertNotification(tx, { userId, reportId, type, title, message }) {
  const uid = String(userId || "").trim();
  const rid = String(reportId || "").trim();
  if (!isGuid(uid)) return;

  const reqq = new sql.Request(tx);
  reqq.input("UserId", sql.UniqueIdentifier, uid);
  reqq.input("ReportId", sql.UniqueIdentifier, isGuid(rid) ? rid : null);
  reqq.input("Type", sql.NVarChar(30), String(type || "info"));
  reqq.input("Title", sql.NVarChar(150), String(title || ""));
  reqq.input("Message", sql.NVarChar(sql.MAX), String(message || ""));

  await reqq.query(`
    INSERT INTO dbo.Notifications
      (Id, UserId, ReportId, Type, Title, Message, IsRead, CreatedAt)
    VALUES
      (NEWID(), @UserId, @ReportId, @Type, @Title, @Message, 0, SYSDATETIME())
  `);
}

// ---------- Employees ----------
exports.listEmployees = async (req, res) => {
  try {
    const deptId = getDeptId(req);
    if (!deptId) return res.status(400).json({ message: "departmentId missing/invalid in token" });

    const pool = await poolPromise;

    const r = await pool
      .request()
      .input("DepartmentId", sql.UniqueIdentifier, deptId)
      .query(`
        SELECT UserId, FullName, Phone, Email, Role, DepartmentId, IsActive, CreatedAt
        FROM dbo.UsersProfile
        WHERE DepartmentId = @DepartmentId AND LOWER(Role) = 'employee'
        ORDER BY CreatedAt DESC
      `);

    return res.json({ items: r.recordset || [] });
  } catch (err) {
    console.error("MANAGER listEmployees ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};

exports.createEmployee = async (req, res) => {
  try {
    const deptId = getDeptId(req);
    if (!deptId) return res.status(400).json({ message: "departmentId missing/invalid in token" });

    const { fullName, email, phone, nationalId, password } = req.body || {};
    const name = normStr(fullName);
    const em = normStr(email).toLowerCase();
    const ph = cleanPhone(phone);
    const nid = String(nationalId || "").replace(/[^\d]/g, "");
    const pw = String(password || "");

    if (name.length < 3) return res.status(400).json({ message: "الاسم غير صحيح" });
    if (!isEmail(em)) return res.status(400).json({ message: "البريد غير صحيح" });
    if (!ph) return res.status(400).json({ message: "رقم الجوال مطلوب" });
    if (pw.length < 6) return res.status(400).json({ message: "كلمة المرور لازم 6 أحرف+" });

    const pool = await poolPromise;

    const exists = await pool
      .request()
      .input("Email", sql.NVarChar(150), em)
      .input("Phone", sql.NVarChar(50), ph)
      .input("NationalId", sql.NVarChar(50), nid)
      .query(`
        SELECT TOP 1 UserId
        FROM dbo.UsersProfile
        WHERE Email = @Email
           OR Phone = @Phone
           OR (LTRIM(RTRIM(@NationalId)) <> '' AND NationalId = @NationalId)
      `);

    if (exists.recordset?.length)
      return res.status(409).json({ message: "الموظف موجود مسبقًا (بريد/جوال/هوية)" });

    const hash = await bcrypt.hash(pw, 10);

    const ins = await pool
      .request()
      .input("FullName", sql.NVarChar(200), name)
      .input("Email", sql.NVarChar(150), em)
      .input("Phone", sql.NVarChar(50), ph)
      .input("NationalId", sql.NVarChar(50), nid)
      .input("PasswordHash", sql.NVarChar(250), hash)
      .input("DepartmentId", sql.UniqueIdentifier, deptId)
      .query(`
        INSERT INTO dbo.UsersProfile
          (UserId, FullName, Phone, Role, DepartmentId, IsActive, CreatedAt, Email, NationalId, PasswordHash)
        OUTPUT INSERTED.UserId, INSERTED.FullName, INSERTED.Phone, INSERTED.Email,
               INSERTED.Role, INSERTED.DepartmentId, INSERTED.IsActive, INSERTED.CreatedAt
        VALUES
          (NEWID(), @FullName, @Phone, 'employee', @DepartmentId, 1, SYSDATETIME(), @Email, @NationalId, @PasswordHash)
      `);

    return res.status(201).json({ item: ins.recordset?.[0] });
  } catch (err) {
    console.error("MANAGER createEmployee ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};

exports.disableEmployee = async (req, res) => {
  try {
    const deptId = getDeptId(req);
    const userId = String(req.params.userId || "").trim();

    if (!deptId) return res.status(400).json({ message: "departmentId missing/invalid in token" });
    if (!isGuid(userId)) return res.status(400).json({ message: "Invalid userId" });

    const pool = await poolPromise;

    const r = await pool
      .request()
      .input("UserId", sql.UniqueIdentifier, userId)
      .input("DepartmentId", sql.UniqueIdentifier, deptId)
      .query(`
        UPDATE dbo.UsersProfile
        SET IsActive = 0
        WHERE UserId = @UserId AND DepartmentId = @DepartmentId AND LOWER(Role) = 'employee';

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

exports.setEmployeeActive = async (req, res) => {
  try {
    const deptId = getDeptId(req);
    const userId = String(req.params.userId || "").trim();

    if (!deptId) return res.status(400).json({ message: "departmentId missing/invalid in token" });
    if (!isGuid(userId)) return res.status(400).json({ message: "Invalid userId" });

    const desired = normBool01(req.body?.isActive); // 1/0/null
    const pool = await poolPromise;

    const cur = await pool
      .request()
      .input("UserId", sql.UniqueIdentifier, userId)
      .input("DepartmentId", sql.UniqueIdentifier, deptId)
      .query(`
        SELECT TOP 1 IsActive
        FROM dbo.UsersProfile
        WHERE UserId = @UserId AND DepartmentId = @DepartmentId AND LOWER(Role) = 'employee'
      `);

    const row = cur.recordset?.[0];
    if (!row) return res.status(404).json({ message: "موظف غير موجود ضمن جهتك" });

    const current = row.IsActive === true || row.IsActive === 1 || String(row.IsActive) === "1";
    const next = desired === null ? (current ? 0 : 1) : desired;

    const r = await pool
      .request()
      .input("UserId", sql.UniqueIdentifier, userId)
      .input("DepartmentId", sql.UniqueIdentifier, deptId)
      .input("IsActive", sql.Bit, next ? 1 : 0)
      .query(`
        UPDATE dbo.UsersProfile
        SET IsActive = @IsActive
        WHERE UserId = @UserId AND DepartmentId = @DepartmentId AND LOWER(Role) = 'employee';

        SELECT @@ROWCOUNT AS affected;
      `);

    if (!r.recordset?.[0]?.affected)
      return res.status(404).json({ message: "موظف غير موجود ضمن جهتك" });

    return res.json({ message: next ? "تم تفعيل الموظف" : "تم إيقاف الموظف", isActive: !!next });
  } catch (err) {
    console.error("MANAGER setEmployeeActive ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};

exports.updateEmployee = async (req, res) => {
  try {
    const deptId = getDeptId(req);
    const userId = String(req.params.userId || "").trim();

    if (!deptId) return res.status(400).json({ message: "departmentId missing/invalid in token" });
    if (!isGuid(userId)) return res.status(400).json({ message: "Invalid userId" });

    const fullName = normStr(req.body?.fullName);
    const email = normStr(req.body?.email).toLowerCase();
    const phone = cleanPhone(req.body?.phone);
    const nationalId = String(req.body?.nationalId || "").replace(/[^\d]/g, "");
    const password = String(req.body?.password || "");

    if (!fullName && !email && !phone && !nationalId && !password)
      return res.status(400).json({ message: "لا توجد بيانات للتعديل" });

    if (email && !isEmail(email)) return res.status(400).json({ message: "البريد غير صحيح" });
    if (fullName && fullName.length < 3) return res.status(400).json({ message: "الاسم غير صحيح" });
    if (password && password.length < 6) return res.status(400).json({ message: "كلمة المرور لازم 6 أحرف+" });

    const pool = await poolPromise;

    const emp = await pool
      .request()
      .input("UserId", sql.UniqueIdentifier, userId)
      .input("DepartmentId", sql.UniqueIdentifier, deptId)
      .query(`
        SELECT TOP 1 UserId
        FROM dbo.UsersProfile
        WHERE UserId = @UserId AND DepartmentId = @DepartmentId AND LOWER(Role) = 'employee'
      `);

    if (!emp.recordset?.length) return res.status(404).json({ message: "موظف غير موجود ضمن جهتك" });

    if (email || phone || nationalId) {
      const dup = await pool
        .request()
        .input("UserId", sql.UniqueIdentifier, userId)
        .input("Email", sql.NVarChar(150), email || "")
        .input("Phone", sql.NVarChar(50), phone || "")
        .input("NationalId", sql.NVarChar(50), nationalId || "")
        .query(`
          SELECT TOP 1 UserId
          FROM dbo.UsersProfile
          WHERE UserId <> @UserId
            AND (
              (@Email <> '' AND Email = @Email)
              OR (@Phone <> '' AND Phone = @Phone)
              OR (LTRIM(RTRIM(@NationalId)) <> '' AND NationalId = @NationalId)
            )
        `);

      if (dup.recordset?.length)
        return res.status(409).json({ message: "لا يمكن التعديل: (بريد/جوال/هوية) مستخدمة مسبقًا" });
    }

    const sets = [];
    const reqq = pool
      .request()
      .input("UserId", sql.UniqueIdentifier, userId)
      .input("DepartmentId", sql.UniqueIdentifier, deptId);

    if (fullName) {
      sets.push("FullName = @FullName");
      reqq.input("FullName", sql.NVarChar(200), fullName);
    }
    if (email) {
      sets.push("Email = @Email");
      reqq.input("Email", sql.NVarChar(150), email);
    }
    if (phone) {
      sets.push("Phone = @Phone");
      reqq.input("Phone", sql.NVarChar(50), phone);
    }
    if (nationalId) {
      sets.push("NationalId = @NationalId");
      reqq.input("NationalId", sql.NVarChar(50), nationalId);
    }
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      sets.push("PasswordHash = @PasswordHash");
      reqq.input("PasswordHash", sql.NVarChar(250), hash);
    }

    if (!sets.length) return res.status(400).json({ message: "لا توجد بيانات صالحة للتعديل" });

    const q = `
      UPDATE dbo.UsersProfile
      SET ${sets.join(", ")}
      WHERE UserId = @UserId AND DepartmentId = @DepartmentId AND LOWER(Role) = 'employee';

      SELECT TOP 1 UserId, FullName, Phone, Email, Role, DepartmentId, IsActive, CreatedAt
      FROM dbo.UsersProfile
      WHERE UserId = @UserId;
    `;

    const r = await reqq.query(q);
    const item = r.recordset?.[0] || null;

    return res.json({ message: "تم تحديث بيانات الموظف", item });
  } catch (err) {
    console.error("MANAGER updateEmployee ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};

exports.deleteEmployeeHard = async (req, res) => {
  try {
    const deptId = getDeptId(req);
    const userId = String(req.params.userId || "").trim();

    if (!deptId) return res.status(400).json({ message: "departmentId missing/invalid in token" });
    if (!isGuid(userId)) return res.status(400).json({ message: "Invalid userId" });

    const pool = await poolPromise;

    const emp = await pool
      .request()
      .input("UserId", sql.UniqueIdentifier, userId)
      .input("DepartmentId", sql.UniqueIdentifier, deptId)
      .query(`
        SELECT TOP 1 UserId
        FROM dbo.UsersProfile
        WHERE UserId = @UserId AND DepartmentId = @DepartmentId AND LOWER(Role) = 'employee'
      `);

    if (!emp.recordset?.length) return res.status(404).json({ message: "موظف غير موجود ضمن جهتك" });

    try {
      await pool
        .request()
        .input("UserId", sql.UniqueIdentifier, userId)
        .input("DepartmentId", sql.UniqueIdentifier, deptId)
        .query(`
          DELETE FROM dbo.UsersProfile
          WHERE UserId = @UserId AND DepartmentId = @DepartmentId AND LOWER(Role) = 'employee';
        `);

      return res.json({ message: "تم حذف الموظف نهائيًا" });
    } catch (e) {
      return res.status(409).json({
        message:
          "لا يمكن حذف الموظف نهائيًا لأن له سجلات مرتبطة بالنظام. استخدم (توقيف/تفعيل) بدل الحذف.",
      });
    }
  } catch (err) {
    console.error("MANAGER deleteEmployeeHard ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};

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
        SELECT r.Id, r.UserId, r.DepartmentId, r.Description, r.Status, r.CreatedAt, r.UpdatedAt,
               u.FullName AS ReporterName, u.Phone AS ReporterPhone
        FROM dbo.Reports r
        INNER JOIN dbo.UsersProfile u ON u.UserId = r.UserId
        WHERE r.DepartmentId = @DepartmentId
          AND (@Status = '' OR LOWER(LTRIM(RTRIM(r.Status))) = LOWER(LTRIM(RTRIM(@Status))))
        ORDER BY r.CreatedAt DESC
      `);

    return res.json({ items: r.recordset || [] });
  } catch (err) {
    console.error("MANAGER listReports ERROR:", err);
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

    if (!reportR.recordset?.length) return res.status(404).json({ message: "البلاغ غير موجود ضمن جهتك" });

    const mediaR = await pool
      .request()
      .input("ReportId", sql.UniqueIdentifier, reportId)
      .query(`
        SELECT Id, ReportId, Type, FileUrl, CreatedAt
        FROM dbo.Media
        WHERE ReportId = @ReportId
        ORDER BY CreatedAt DESC
      `);

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
          h.Note,
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
    console.error("MANAGER getReportDetails ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};


exports.updateReportStatus = async (req, res) => {
  let tx;
  try {
    const deptId = getDeptId(req);
    const managerId = getUserId(req);
    const reportId = String(req.params.id || "").trim();
    const nextStatus = normStatus(req.body?.status);

    if (!deptId) return res.status(400).json({ message: "departmentId missing/invalid in token" });
    if (!managerId) return res.status(400).json({ message: "Invalid manager userId in token" });
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
    const ownerId = row.UserId ? String(row.UserId).trim() : null;

    if (oldStatus === nextStatus) {
      await tx.rollback();
      return res.json({ message: "الحالة نفسها (لا يوجد تغيير)" });
    }

    await new sql.Request(tx)
      .input("Id", sql.UniqueIdentifier, reportId)
      .input("Status", sql.NVarChar(20), nextStatus)
      .input("UpdatedBy", sql.UniqueIdentifier, managerId)
      .query(`
        UPDATE dbo.Reports
        SET Status = @Status,
            UpdatedAt = SYSDATETIME(),
            UpdatedBy = @UpdatedBy
        WHERE Id = @Id
      `);

    // سجل التاريخ
    try {
      await new sql.Request(tx)
        .input("ReportId", sql.UniqueIdentifier, reportId)
        .input("ChangedBy", sql.UniqueIdentifier, managerId)
        .input("FromStatus", sql.NVarChar(20), oldStatus)
        .input("ToStatus", sql.NVarChar(20), nextStatus)
        .input("Note", sql.NVarChar(sql.MAX), null)
        .query(`
          INSERT INTO dbo.ReportStatusHistory
            (Id, ReportId, ChangedBy, FromStatus, ToStatus, Note, ChangedAt)
          VALUES
            (NEWID(), @ReportId, @ChangedBy, @FromStatus, @ToStatus, @Note, SYSDATETIME())
        `);
    } catch (_) {}

    //  إشعار لصاحب البلاغ
    if (ownerId && isGuid(ownerId)) {
      let title = "تحديث حالة البلاغ";
      let message = "تم تحديث حالة البلاغ";

      if (nextStatus === "accepted") {
        title = "تم حل البلاغ ";
        message = "تمت معالجة البلاغ بنجاح";
      } else if (nextStatus === "rejected") {
        title = "تم رفض البلاغ ";
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
    console.error("MANAGER updateReportStatus ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};

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
    console.error("MANAGER getStats ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};