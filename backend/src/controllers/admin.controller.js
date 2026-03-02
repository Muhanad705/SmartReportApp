// backend/src/controllers/admin.controller.js
const sql = require("mssql");
const bcrypt = require("bcryptjs");
const poolPromise = require("../../db");

//  إحصائيات الأدمن (اعتمادًا على dbo.Reports.Status)
exports.getStats = async (req, res) => {
  try {
    const pool = await poolPromise;

    // إجمالي + حسب الحالة من عمود Reports.Status
    const statsRes = await pool.request().query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN LOWER(LTRIM(RTRIM(Status))) = 'in_progress' THEN 1 ELSE 0 END) AS inProgress,
        SUM(CASE WHEN LOWER(LTRIM(RTRIM(Status))) = 'accepted' THEN 1 ELSE 0 END) AS accepted,
        SUM(CASE WHEN LOWER(LTRIM(RTRIM(Status))) = 'rejected' THEN 1 ELSE 0 END) AS rejected
      FROM dbo.Reports;
    `);

    // توزيع حسب الجهات (Departments.Id)
    const byDeptRes = await pool.request().query(`
      SELECT
        d.Id AS id,
        d.Name AS name,
        COUNT(r.Id) AS total,
        SUM(CASE WHEN LOWER(LTRIM(RTRIM(r.Status))) = 'in_progress' THEN 1 ELSE 0 END) AS inProgress,
        SUM(CASE WHEN LOWER(LTRIM(RTRIM(r.Status))) = 'accepted' THEN 1 ELSE 0 END) AS accepted,
        SUM(CASE WHEN LOWER(LTRIM(RTRIM(r.Status))) = 'rejected' THEN 1 ELSE 0 END) AS rejected
      FROM dbo.Departments d
      LEFT JOIN dbo.Reports r ON r.DepartmentId = d.Id
      GROUP BY d.Id, d.Name
      ORDER BY total DESC;
    `);

    const s = statsRes.recordset?.[0] || {};
    return res.json({
      totalReports: Number(s.total || 0),
      inProgress: Number(s.inProgress || 0),
      accepted: Number(s.accepted || 0),
      rejected: Number(s.rejected || 0),
      departments: byDeptRes.recordset || [],
    });
  } catch (err) {
    console.error("ADMIN STATS ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
};


exports.listManagers = async (req, res) => {
  try {
    const pool = await poolPromise;

    const r = await pool.request().query(`
      SELECT
        UserId, FullName, Email, Phone, Role, DepartmentId, IsActive, CreatedAt
      FROM dbo.UsersProfile
      WHERE LOWER(LTRIM(RTRIM(Role))) = 'manager'
      ORDER BY CreatedAt DESC;
    `);

    return res.json({ items: r.recordset || [] });
  } catch (err) {
    console.error("LIST MANAGERS ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

//  إضافة مدير (الأدمن هو اللي ينشئه)
exports.createManager = async (req, res) => {
  try {
    const { fullName, email, phone, password, departmentId } = req.body || {};

    const FullName = String(fullName || "").trim();
    const Email = String(email || "").trim().toLowerCase();
    const Phone = String(phone || "").replace(/[^\d]/g, "");
    const Password = String(password || "");

    if (!FullName || FullName.length < 3) return res.status(400).json({ message: "الاسم غير صحيح" });
    if (!Email) return res.status(400).json({ message: "البريد مطلوب" });
    if (!Password || Password.length < 6) return res.status(400).json({ message: "كلمة المرور ضعيفة" });

    const pool = await poolPromise;

    //  تأكد البريد مو مستخدم
    const exists = await pool
      .request()
      .input("Email", sql.NVarChar(150), Email)
      .query(`SELECT TOP 1 UserId FROM dbo.UsersProfile WHERE LOWER(LTRIM(RTRIM(Email))) = @Email`);

    if (exists.recordset.length) return res.status(409).json({ message: "البريد مستخدم من قبل" });

    // ✅ لو departmentId مرسل، تأكد الجهة موجودة
    if (departmentId) {
      const deptCheck = await pool
        .request()
        .input("DeptId", sql.UniqueIdentifier, departmentId)
        .query(`SELECT TOP 1 Id FROM dbo.Departments WHERE Id = @DeptId`);

      if (!deptCheck.recordset.length) {
        return res.status(400).json({ message: "الجهة غير موجودة" });
      }
    }

    const hash = await bcrypt.hash(Password, 10);

    await pool
      .request()
      .input("FullName", sql.NVarChar(100), FullName)
      .input("Phone", sql.NVarChar(20), Phone || "")
      .input("Email", sql.NVarChar(150), Email)
      .input("PasswordHash", sql.NVarChar(255), hash)
      .input("DepartmentId", sql.UniqueIdentifier, departmentId ? departmentId : null)
      .query(`
        INSERT INTO dbo.UsersProfile
          (UserId, FullName, Phone, Role, DepartmentId, IsActive, CreatedAt, Email, NationalId, PasswordHash, NotificationsEnabled)
        VALUES
          (NEWID(), @FullName, @Phone, 'manager', @DepartmentId, 1, SYSDATETIME(), @Email, NULL, @PasswordHash, 1)
      `);

    return res.status(201).json({ message: "تم إنشاء مدير بنجاح" });
  } catch (err) {
    console.error("CREATE MANAGER ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
// ✅ تعديل مدير (تعديل جزئي: الاسم/البريد/الجوال/الجهة/كلمة المرور اختيارية)
exports.updateManager = async (req, res) => {
  try {
    const { userId } = req.params || {};
    if (!userId) return res.status(400).json({ message: "userId required" });

    const pool = await poolPromise;

    // تأكد أنه مدير موجود
    const currentRes = await pool
      .request()
      .input("UserId", sql.UniqueIdentifier, userId)
      .query(`
        SELECT TOP 1 UserId, Email, Role
        FROM dbo.UsersProfile
        WHERE UserId = @UserId AND LOWER(LTRIM(RTRIM(Role))) = 'manager'
      `);

    if (!currentRes.recordset?.length) {
      return res.status(404).json({ message: "المدير غير موجود" });
    }

    // استقبل حقول اختيارية
    const fullNameRaw = req.body?.fullName;
    const emailRaw = req.body?.email;
    const phoneRaw = req.body?.phone;
    const passwordRaw = req.body?.password;
    const departmentIdRaw = req.body?.departmentId;

    const FullName = fullNameRaw !== undefined ? String(fullNameRaw || "").trim() : undefined;
    const Email = emailRaw !== undefined ? String(emailRaw || "").trim().toLowerCase() : undefined;
    const Phone = phoneRaw !== undefined ? String(phoneRaw || "").replace(/[^\d]/g, "") : undefined;
    const Password = passwordRaw !== undefined ? String(passwordRaw || "") : undefined;
    const DepartmentId = departmentIdRaw !== undefined ? (departmentIdRaw ? String(departmentIdRaw) : null) : undefined;

    // Validation بسيط
    if (FullName !== undefined && FullName.length < 3) {
      return res.status(400).json({ message: "الاسم غير صحيح" });
    }
    if (Email !== undefined) {
      if (!Email) return res.status(400).json({ message: "البريد مطلوب" });

      // تأكد البريد مو مستخدم عند شخص ثاني
      const exists = await pool
        .request()
        .input("Email", sql.NVarChar(150), Email)
        .input("UserId", sql.UniqueIdentifier, userId)
        .query(`
          SELECT TOP 1 UserId
          FROM dbo.UsersProfile
          WHERE LOWER(LTRIM(RTRIM(Email))) = @Email AND UserId <> @UserId
        `);

      if (exists.recordset?.length) return res.status(409).json({ message: "البريد مستخدم من قبل" });
    }

    // departmentId لو جاء: تحقق الجهة (أو null لفك الربط)
    if (DepartmentId !== undefined && DepartmentId !== null) {
      const deptCheck = await pool
        .request()
        .input("DeptId", sql.UniqueIdentifier, DepartmentId)
        .query(`SELECT TOP 1 Id FROM dbo.Departments WHERE Id = @DeptId`);

      if (!deptCheck.recordset?.length) {
        return res.status(400).json({ message: "الجهة غير موجودة" });
      }
    }

    
    let PasswordHash = undefined;
    if (Password !== undefined && Password !== "") {
      if (Password.length < 6) return res.status(400).json({ message: "كلمة المرور ضعيفة" });
      PasswordHash = await bcrypt.hash(Password, 10);
    }

   
    const hasAny =
      FullName !== undefined ||
      Email !== undefined ||
      Phone !== undefined ||
      DepartmentId !== undefined ||
      PasswordHash !== undefined;

    if (!hasAny) return res.status(400).json({ message: "لا يوجد حقول للتعديل" });

    // UPDATE ديناميكي
    const sets = [];
    const reqq = pool.request().input("UserId", sql.UniqueIdentifier, userId);

    if (FullName !== undefined) {
      sets.push("FullName = @FullName");
      reqq.input("FullName", sql.NVarChar(100), FullName);
    }
    if (Email !== undefined) {
      sets.push("Email = @Email");
      reqq.input("Email", sql.NVarChar(150), Email);
    }
    if (Phone !== undefined) {
      sets.push("Phone = @Phone");
      reqq.input("Phone", sql.NVarChar(20), Phone || "");
    }
    if (DepartmentId !== undefined) {
      sets.push("DepartmentId = @DepartmentId");
      reqq.input("DepartmentId", sql.UniqueIdentifier, DepartmentId); 
    }
    if (PasswordHash !== undefined) {
      sets.push("PasswordHash = @PasswordHash");
      reqq.input("PasswordHash", sql.NVarChar(255), PasswordHash);
    }

    await reqq.query(`
      UPDATE dbo.UsersProfile
      SET ${sets.join(", ")}
      WHERE UserId = @UserId AND LOWER(LTRIM(RTRIM(Role))) = 'manager'
    `);

    return res.json({ message: "تم تحديث بيانات المدير" });
  } catch (err) {
    console.error("UPDATE MANAGER ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
//  حذف مدير
exports.deleteManager = async (req, res) => {
  try {
    const { userId } = req.params || {};
    if (!userId) return res.status(400).json({ message: "userId required" });

    const pool = await poolPromise;

    await pool
      .request()
      .input("UserId", sql.UniqueIdentifier, userId)
      .query(`
        DELETE FROM dbo.UsersProfile
        WHERE UserId = @UserId AND LOWER(LTRIM(RTRIM(Role))) = 'manager'
      `);

    return res.json({ message: "تم الحذف" });
  } catch (err) {
    console.error("DELETE MANAGER ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
};