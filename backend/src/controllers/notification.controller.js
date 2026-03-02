// backend/src/controllers/notification.controller.js
const sql = require("mssql");
const poolPromise = require("../../db");

const isGuid = (v) =>
  typeof v === "string" &&
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(v);

// ✅ GET /api/notifications/my/:userId
exports.getMyNotifications = async (req, res) => {
  const userId = String(req.params?.userId || "").trim();
  if (!isGuid(userId)) return res.status(400).json({ message: "userId غير صحيح" });

  try {
    const pool = await poolPromise;

    const r = await pool
      .request()
      .input("UserId", sql.UniqueIdentifier, userId)
      .query(`
        SELECT TOP 200
          Id,
          Type,
          Title,
          Message,
          IsRead,
          CreatedAt,
          ReportId
        FROM Notifications
        WHERE UserId = @UserId
        ORDER BY CreatedAt DESC
      `);

    const out = (r.recordset || []).map((x) => ({
      id: String(x.Id),
      title: x.Title || "",
      body: x.Message || "", // Message -> body للواجهة
      read: !!x.IsRead,
      createdAt: x.CreatedAt ? new Date(x.CreatedAt).getTime() : Date.now(),

   
      route: "MyReports",
      params: x.ReportId ? { reportId: String(x.ReportId) } : null,

    
      type: x.Type || null,
      reportId: x.ReportId ? String(x.ReportId) : null,
    }));

    return res.json(out);
  } catch (err) {
    console.error("GET NOTIFICATIONS ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};


exports.markRead = async (req, res) => {
  const id = String(req.params?.id || "").trim();
  if (!isGuid(id)) return res.status(400).json({ message: "id غير صحيح" });

  try {
    const pool = await poolPromise;
    await pool
      .request()
      .input("Id", sql.UniqueIdentifier, id)
      .query(`
        UPDATE Notifications
        SET IsRead = 1
        WHERE Id = @Id
      `);

    return res.json({ message: "تم" });
  } catch (err) {
    console.error("MARK READ ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};


exports.markAllRead = async (req, res) => {
  const userId = String(req.params?.userId || "").trim();
  if (!isGuid(userId)) return res.status(400).json({ message: "userId غير صحيح" });

  try {
    const pool = await poolPromise;
    await pool
      .request()
      .input("UserId", sql.UniqueIdentifier, userId)
      .query(`
        UPDATE Notifications
        SET IsRead = 1
        WHERE UserId = @UserId
      `);

    return res.json({ message: "تم" });
  } catch (err) {
    console.error("MARK ALL READ ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};


exports.removeOne = async (req, res) => {
  const id = String(req.params?.id || "").trim();
  if (!isGuid(id)) return res.status(400).json({ message: "id غير صحيح" });

  try {
    const pool = await poolPromise;
    await pool
      .request()
      .input("Id", sql.UniqueIdentifier, id)
      .query(`DELETE FROM Notifications WHERE Id = @Id`);

    return res.json({ message: "تم" });
  } catch (err) {
    console.error("REMOVE ONE ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};


exports.clearAll = async (req, res) => {
  const userId = String(req.params?.userId || "").trim();
  if (!isGuid(userId)) return res.status(400).json({ message: "userId غير صحيح" });

  try {
    const pool = await poolPromise;
    await pool
      .request()
      .input("UserId", sql.UniqueIdentifier, userId)
      .query(`DELETE FROM Notifications WHERE UserId = @UserId`);

    return res.json({ message: "تم" });
  } catch (err) {
    console.error("CLEAR ALL ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};