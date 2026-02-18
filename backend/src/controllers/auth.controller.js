// backend/src/controllers/auth.controller.js
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const sql = require("mssql");
const poolPromise = require("../../db");

// مساعدات
const normEmail = (v) => String(v || "").trim().toLowerCase();
const onlyDigits = (v) => String(v || "").replace(/[^\d]/g, "");

exports.register = async (req, res) => {
  try {
    const { fullName, email, phone, nationalId, password } = req.body || {};

    const FullName = String(fullName || "").trim();
    const Email = normEmail(email);
    const Phone = onlyDigits(phone);
    const NationalId = onlyDigits(nationalId);
    const Password = String(password || "");

    if (!FullName || FullName.length < 6) return res.status(400).json({ message: "الاسم غير صحيح" });
    if (!Email) return res.status(400).json({ message: "البريد مطلوب" });
    if (!Phone) return res.status(400).json({ message: "رقم الجوال مطلوب" });
    if (!Password) return res.status(400).json({ message: "كلمة المرور مطلوبة" });

    const pool = await poolPromise;

    const check = await pool
      .request()
      .input("Email", sql.NVarChar, Email)
      .query("SELECT TOP 1 UserId FROM dbo.UsersProfile WHERE Email = @Email");

    if (check.recordset.length) return res.status(409).json({ message: "البريد مستخدم من قبل" });

    const hash = await bcrypt.hash(Password, 10);
    const Role = "user";

    await pool
      .request()
      .input("FullName", sql.NVarChar, FullName)
      .input("Phone", sql.NVarChar, Phone)
      .input("Role", sql.NVarChar, Role)
      .input("Email", sql.NVarChar, Email)
      .input("NationalId", sql.NVarChar, NationalId || null)
      .input("PasswordHash", sql.NVarChar, hash)
      .query(`
        INSERT INTO dbo.UsersProfile
          ([UserId], [FullName], [Phone], [Role], [DepartmentId], [IsActive], [CreatedAt], [Email], [NationalId], [PasswordHash])
        VALUES
          (NEWID(), @FullName, @Phone, @Role, NULL, 1, SYSDATETIME(), @Email, @NationalId, @PasswordHash)
      `);

    return res.status(201).json({ message: "تم إنشاء الحساب بنجاح" });
  } catch (err) {
    console.error("REGISTER ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const Email = normEmail(email);
    const Password = String(password || "");

    if (!Email || !Password) return res.status(400).json({ message: "أدخل البريد وكلمة المرور" });

    const pool = await poolPromise;

    const r = await pool
      .request()
      .input("Email", sql.NVarChar, Email)
      .query(`
        SELECT TOP 1
          UserId, FullName, Phone, Role, DepartmentId, IsActive, Email, NationalId, PasswordHash
        FROM dbo.UsersProfile
        WHERE Email = @Email
      `);

    const u = r.recordset?.[0];
    if (!u) return res.status(401).json({ message: "بيانات الدخول غير صحيحة" });
    if (u.IsActive === false || u.IsActive === 0) return res.status(403).json({ message: "الحساب موقوف" });

    const ok = await bcrypt.compare(Password, u.PasswordHash);
    if (!ok) return res.status(401).json({ message: "بيانات الدخول غير صحيحة" });

    const token = "dummy-token";

    return res.json({
      token,
      user: {
        userId: u.UserId,
        fullName: u.FullName,
        email: u.Email,
        phone: u.Phone,
        nationalId: u.NationalId,
        role: u.Role,
        departmentId: u.DepartmentId,
      },
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body || {};
    const Email = normEmail(email);
    if (!Email) return res.status(400).json({ message: "البريد مطلوب" });

    const pool = await poolPromise;

    // 1) تأكد البريد موجود
    const r = await pool
      .request()
      .input("Email", sql.NVarChar, Email)
      .query(`SELECT TOP 1 UserId, IsActive FROM dbo.UsersProfile WHERE Email = @Email`);

    const u = r.recordset?.[0];
    if (!u) return res.status(404).json({ message: "البريد غير موجود" });
    if (u.IsActive === false || u.IsActive === 0) return res.status(403).json({ message: "الحساب موقوف" });

    // 2) أنشئ توكن (15 دقيقة)
    const resetToken = crypto.randomBytes(24).toString("hex");
    const tokenHash = await bcrypt.hash(resetToken, 10);
    const expiresMinutes = 15;

    await pool
      .request()
      .input("UserId", sql.UniqueIdentifier, u.UserId)
      .input("TokenHash", sql.NVarChar(255), tokenHash)
      .input("ExpiresAt", sql.DateTime2, new Date(Date.now() + expiresMinutes * 60 * 1000))
      .query(`
        INSERT INTO dbo.PasswordResetTokens (Id, UserId, TokenHash, ExpiresAt, CreatedAt)
        VALUES (NEWID(), @UserId, @TokenHash, @ExpiresAt, SYSDATETIME())
      `);

    // للتجربة فقط: نرجّع التوكن (لأن الإيميل الحقيقي مو مضاف)
    return res.json({
      message: "تم إنشاء طلب استعادة كلمة المرور ✅",
      resetToken,
      expiresInMinutes: expiresMinutes,
    });
  } catch (err) {
    console.error("FORGOT ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { email, resetToken, newPassword } = req.body || {};
    const Email = normEmail(email);
    const Token = String(resetToken || "").trim();
    const PW = String(newPassword || "");

    if (!Email || !Token || !PW) return res.status(400).json({ message: "البيانات ناقصة" });
    if (PW.length < 8) return res.status(400).json({ message: "كلمة المرور ضعيفة (8+)" });

    const pool = await poolPromise;

    // 1) المستخدم
    const uRes = await pool
      .request()
      .input("Email", sql.NVarChar, Email)
      .query(`SELECT TOP 1 UserId, IsActive FROM dbo.UsersProfile WHERE Email = @Email`);

    const u = uRes.recordset?.[0];
    if (!u) return res.status(404).json({ message: "المستخدم غير موجود" });
    if (u.IsActive === false || u.IsActive === 0) return res.status(403).json({ message: "الحساب موقوف" });

    // 2) آخر توكن صالح وغير مستخدم
    const tRes = await pool
      .request()
      .input("UserId", sql.UniqueIdentifier, u.UserId)
      .query(`
        SELECT TOP 1 Id, TokenHash, ExpiresAt, UsedAt, CreatedAt
        FROM dbo.PasswordResetTokens
        WHERE UserId = @UserId
          AND UsedAt IS NULL
          AND ExpiresAt > SYSDATETIME()
        ORDER BY CreatedAt DESC
      `);

    const t = tRes.recordset?.[0];
    if (!t) return res.status(400).json({ message: "لا يوجد توكن صالح. اطلب توكن جديد." });

    // 3) تحقق من التوكن
    const ok = await bcrypt.compare(Token, String(t.TokenHash));
    if (!ok) return res.status(400).json({ message: "رمز الاستعادة غير صحيح" });

    // 4) تحديث كلمة المرور + تعليم التوكن كمستخدم (Transaction)
    const newHash = await bcrypt.hash(PW, 10);

    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      await new sql.Request(tx)
        .input("UserId", sql.UniqueIdentifier, u.UserId)
        .input("PasswordHash", sql.NVarChar, newHash)
        .query(`
          UPDATE dbo.UsersProfile
          SET PasswordHash = @PasswordHash
          WHERE UserId = @UserId
        `);

      await new sql.Request(tx)
        .input("Id", sql.UniqueIdentifier, t.Id)
        .query(`
          UPDATE dbo.PasswordResetTokens
          SET UsedAt = SYSDATETIME()
          WHERE Id = @Id
        `);

      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    }

    return res.json({ message: "تم تحديث كلمة المرور بنجاح " });
  } catch (err) {
    console.error("RESET PASSWORD ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};
