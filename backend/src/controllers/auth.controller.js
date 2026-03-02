// backend/src/controllers/auth.controller.js
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const sql = require("mssql");
const jwt = require("jsonwebtoken");
const poolPromise = require("../../db");

// مساعدات
const normEmail = (v) => String(v || "").trim().toLowerCase();
const onlyDigits = (v) => String(v || "").replace(/[^\d]/g, "");
const normRole = (v) => String(v || "user").trim().toLowerCase();

function ensureJwtSecret() {
  const s = String(process.env.JWT_SECRET || "").trim();
  if (!s) throw new Error("JWT_SECRET is missing in .env");
  return s;
}

exports.register = async (req, res) => {
  try {
    const { fullName, email, phone, nationalId, password } = req.body || {};

    const FullName = String(fullName || "").trim();
    const Email = normEmail(email);
    const Phone = onlyDigits(phone);
    const NationalId = onlyDigits(nationalId);
    const Password = String(password || "");

    if (!FullName || FullName.length < 6)
      return res.status(400).json({ message: "الاسم غير صحيح" });
    if (!Email) return res.status(400).json({ message: "البريد مطلوب" });
    if (!Phone) return res.status(400).json({ message: "رقم الجوال مطلوب" });
    if (!Password) return res.status(400).json({ message: "كلمة المرور مطلوبة" });

    const pool = await poolPromise;

    // تحقق بريد (مطبع)
    const check = await pool
      .request()
      .input("Email", sql.NVarChar(150), Email)
      .query(`
        SELECT TOP 1 UserId
        FROM dbo.UsersProfile
        WHERE LOWER(LTRIM(RTRIM(Email))) = @Email
      `);

    if (check.recordset.length)
      return res.status(409).json({ message: "البريد مستخدم من قبل" });

    const hash = await bcrypt.hash(Password, 10);
    const Role = "user";

    await pool
      .request()
      .input("FullName", sql.NVarChar(100), FullName)
      .input("Phone", sql.NVarChar(20), Phone)
      .input("Role", sql.NVarChar(20), Role)
      .input("Email", sql.NVarChar(150), Email)
      .input("NationalId", sql.NVarChar(20), NationalId || null)
      .input("PasswordHash", sql.NVarChar(255), hash)
      .query(`
        INSERT INTO dbo.UsersProfile
          ([UserId], [FullName], [Phone], [Role], [DepartmentId], [IsActive], [CreatedAt], [Email], [NationalId], [PasswordHash], [NotificationsEnabled])
        VALUES
          (NEWID(), @FullName, @Phone, @Role, NULL, 1, SYSDATETIME(), @Email, @NationalId, @PasswordHash, 1)
      `);

    return res.status(201).json({ message: "تم إنشاء الحساب بنجاح" });
  } catch (err) {
    // لو عندك Unique Index في DB على الإيميل: رجّع 409 بدل 500
    if (err?.number === 2601 || err?.number === 2627) {
      return res.status(409).json({ message: "البريد مستخدم من قبل" });
    }

    console.error("REGISTER ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const Email = normEmail(email);
    const Password = String(password || "");

    if (!Email || !Password)
      return res.status(400).json({ message: "أدخل البريد وكلمة المرور" });

    const pool = await poolPromise;

    const r = await pool
      .request()
      .input("Email", sql.NVarChar(150), Email)
      .query(`
        SELECT TOP 1
          UserId, FullName, Phone, Role, DepartmentId, IsActive, Email, NationalId, PasswordHash
        FROM dbo.UsersProfile
        WHERE LOWER(LTRIM(RTRIM(Email))) = @Email
      `);

    const u = r.recordset?.[0];
    if (!u) return res.status(401).json({ message: "بيانات الدخول غير صحيحة" });
    if (u.IsActive === false || u.IsActive === 0)
      return res.status(403).json({ message: "الحساب موقوف" });

    const ok = await bcrypt.compare(Password, String(u.PasswordHash || ""));
    if (!ok) return res.status(401).json({ message: "بيانات الدخول غير صحيحة" });

    const role = normRole(u.Role);
    const jwtSecret = ensureJwtSecret();

   const token = jwt.sign(
  { userId: u.UserId, role, departmentId: u.DepartmentId },
  jwtSecret,
  { expiresIn: "7d" }
);

    return res.json({
      token,
      user: {
        userId: u.UserId,
        fullName: u.FullName,
        email: u.Email,
        phone: u.Phone,
        nationalId: u.NationalId,
        role,
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

    // تأكد البريد موجود (مطبع)
    const r = await pool
      .request()
      .input("Email", sql.NVarChar(150), Email)
      .query(`
        SELECT TOP 1 UserId, IsActive
        FROM dbo.UsersProfile
        WHERE LOWER(LTRIM(RTRIM(Email))) = @Email
      `);

    const u = r.recordset?.[0];
    if (!u) return res.status(404).json({ message: "البريد غير موجود" });
    if (u.IsActive === false || u.IsActive === 0)
      return res.status(403).json({ message: "الحساب موقوف" });

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

    return res.json({
      message: "تم إنشاء طلب استعادة كلمة المرور",
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

    // المستخدم (مطبع)
    const uRes = await pool
      .request()
      .input("Email", sql.NVarChar(150), Email)
      .query(`
        SELECT TOP 1 UserId, IsActive
        FROM dbo.UsersProfile
        WHERE LOWER(LTRIM(RTRIM(Email))) = @Email
      `);

    const u = uRes.recordset?.[0];
    if (!u) return res.status(404).json({ message: "المستخدم غير موجود" });
    if (u.IsActive === false || u.IsActive === 0) return res.status(403).json({ message: "الحساب موقوف" });

    // آخر توكن صالح
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

    const ok = await bcrypt.compare(Token, String(t.TokenHash));
    if (!ok) return res.status(400).json({ message: "رمز الاستعادة غير صحيح" });

    const newHash = await bcrypt.hash(PW, 10);

    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      await new sql.Request(tx)
        .input("UserId", sql.UniqueIdentifier, u.UserId)
        .input("PasswordHash", sql.NVarChar(255), newHash)
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

    return res.json({ message: "تم تحديث كلمة المرور بنجاح" });
  } catch (err) {
    console.error("RESET PASSWORD ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};