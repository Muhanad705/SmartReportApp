// backend/src/routes/upload.routes.js
const router = require("express").Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// تأكد مجلد uploads موجود
const UPLOAD_DIR = path.join(__dirname, "../../uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname || "");
    const name = `f_${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 }, // 30MB
});

router.post("/single", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "لا يوجد ملف" });

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const fileUrl = `${baseUrl}/uploads/${req.file.filename}`;

    // نوع مبسط
    const mime = String(req.file.mimetype || "").toLowerCase();
    const type = mime.startsWith("video/") ? "video" : "image";

    return res.json({ fileUrl, type });
  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
});

module.exports = router;
