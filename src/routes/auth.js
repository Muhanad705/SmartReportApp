const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { sql, getPool } = require("../../backend/db");

const router = express.Router();

function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(v || "").trim());
}

router.post("/signup", async (req, res) => {
  try {
    const { fullName, email, phone, nationalId, password } = req.body;

    if (!fullName || String(fullName).trim().length < 6)
      return res.status(400).json({ message: "الاسم غير صحيح" });

    if (!isEmail(email))
      return res.status(400).json({ message: "البريد غير صحيح" });

    if (!phone || String(phone).trim().length < 8)
      return res.status(400).json({ message: "رقم الجوال غير صحيح" });

    if (!password || String(password).length < 8)
      return res.status(400).json({ message: "كلمة المرور ضعيفة" });

    const pool = await getPool();
    const e = String(email).trim().toLowerCase();

    const exists = await pool.request()
      .input("Email", sql.NVarChar(150), e)
      .query(`SELECT TOP 1 UserId FROM dbo.UsersProfile WHERE Email = @Email`);

    if (exists.recordset.length)
      return res.status(409).json({ message: "البريد مسجل مسبقًا" });

    const userId = require("crypto").randomUUID();
    const hash = await bcrypt.hash(String(password), 10);

    await pool.request()
      .input("UserId", sql.UniqueIdentifier, userId)
      .input("FullName", sql.NVarChar(150), String(fullName).trim())
      .input("Phone", sql.NVarChar(30), String(phone).trim())
      .input("Role", sql.NVarChar(20), "user")
      .input("DepartmentId", sql.UniqueIdentifier, null)
      .input("IsActive", sql.Bit, 1)
      .input("Email", sql.NVarChar(150), e)
      .input("NationalId", sql.NVarChar(20), nationalId ? String(nationalId) : null)
      .input("PasswordHash", sql.NVarChar(255), hash)
      .query(`
        INSERT INTO dbo.UsersProfile
        (UserId, FullName, Phone, Role, DepartmentId, IsActive, CreatedAt, Email, NationalId, PasswordHash)
        VALUES
        (@UserId, @FullName, @Phone, @Role, @DepartmentId, @IsActive, GETDATE(), @Email, @NationalId, @PasswordHash)
      `);

    const token = jwt.sign({ userId, role: "user" }, process.env.JWT_SECRET, { expiresIn: "7d" });

    res.json({ token, user: { userId, email: e, role: "user" } });
  } catch (e) {
    res.status(500).json({ message: "خطأ أثناء إنشاء الحساب" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const e = String(email || "").trim().toLowerCase();

    if (!isEmail(e)) return res.status(400).json({ message: "البريد غير صحيح" });

    const pool = await getPool();
    const r = await pool.request()
      .input("Email", sql.NVarChar(150), e)
      .query(`SELECT TOP 1 UserId, Role, PasswordHash, IsActive FROM dbo.UsersProfile WHERE Email=@Email`);

    const u = r.recordset[0];
    if (!u) return res.status(401).json({ message: "بيانات الدخول غير صحيحة" });
    if (u.IsActive === false) return res.status(403).json({ message: "الحساب موقوف" });

    const ok = await bcrypt.compare(String(password || ""), String(u.PasswordHash || ""));
    if (!ok) return res.status(401).json({ message: "بيانات الدخول غير صحيحة" });

    const token = jwt.sign({ userId: u.UserId, role: u.Role }, process.env.JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user: { userId: u.UserId, email: e, role: u.Role } });
  } catch (e) {
    res.status(500).json({ message: "خطأ أثناء تسجيل الدخول" });
  }
});

module.exports = router;
