// backend/src/controllers/report.controller.js
const sql = require("mssql");
const poolPromise = require("../../db");

// Helpers
const isGuid = (v) =>
  typeof v === "string" &&
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(v);

const normStr = (v) => String(v || "").trim();

const ALLOWED_STATUS = new Set(["new", "in_progress", "accepted", "rejected"]);

function normalizeMediaArray(media) {
  if (!Array.isArray(media)) return [];
  return media
    .map((m) => ({
      type: String(m?.type || m?.Type || "").toLowerCase(),
      fileUrl: String(m?.fileUrl || m?.FileUrl || "").trim(),
    }))
    .filter((m) => (m.type === "image" || m.type === "video") && !!m.fileUrl);
}

// =======================
// POST /reports
// body: { userId, departmentId, description, latitude, longitude, media: [{type,fileUrl}] }
// =======================
exports.createReport = async (req, res) => {
  const { userId, departmentId, description, latitude, longitude, lat, lng, media } = req.body || {};

  const UserId = String(userId || "").trim();
  const DepartmentId = String(departmentId || "").trim();
  const Description = normStr(description);

  const Lat = Number(latitude ?? lat);
  const Lng = Number(longitude ?? lng);

  const MediaList = normalizeMediaArray(media);

  if (!isGuid(UserId) || !isGuid(DepartmentId) || !Description) {
    return res.status(400).json({ message: "بيانات ناقصة أو غير صحيحة" });
  }
  if (!Number.isFinite(Lat) || !Number.isFinite(Lng)) {
    return res.status(400).json({ message: "إحداثيات الموقع غير صحيحة" });
  }

  let pool;
  const tx = new sql.Transaction();

  try {
    pool = await poolPromise;
    await tx.begin(pool);

    // 1) إنشاء البلاغ + رجّع Id
    const insertReportReq = new sql.Request(tx);
    const insertReportResult = await insertReportReq
      .input("UserId", sql.UniqueIdentifier, UserId)
      .input("DepartmentId", sql.UniqueIdentifier, DepartmentId)
      .input("Description", sql.NVarChar, Description)
      .input("Lat", sql.Float, Lat)
      .input("Lng", sql.Float, Lng)
      .query(`
        INSERT INTO Reports
          (Id, UserId, DepartmentId, Description, LocationLat, LocationLng, Status, CreatedAt)
        OUTPUT INSERTED.Id AS ReportId
        VALUES
          (NEWID(), @UserId, @DepartmentId, @Description, @Lat, @Lng, 'new', SYSDATETIME())
      `);

    const ReportId = insertReportResult?.recordset?.[0]?.ReportId;
    if (!ReportId) {
      throw new Error("فشل إنشاء البلاغ");
    }

    // 2) حفظ الميديا (إن وجدت)
    if (MediaList.length) {
      for (const m of MediaList) {
        const r = new sql.Request(tx);
        await r
          .input("Id", sql.UniqueIdentifier, ReportId)
          .input("Type", sql.NVarChar, m.type)
          .input("FileUrl", sql.NVarChar, m.fileUrl)
          .query(`
            INSERT INTO Media
              (Id, ReportId, Type, FileUrl, CreatedAt)
            VALUES
              (NEWID(), @Id, @Type, @FileUrl, SYSDATETIME())
          `);
      }
    }

    // 3) (اختياري) سجل الحالة في التاريخ لو جدول ReportStatusHistory موجود
    // إذا جدولك غير موجود احذف هذا البلوك
    try {
      const h = new sql.Request(tx);
      await h
        .input("ReportId", sql.UniqueIdentifier, ReportId)
        .input("OldStatus", sql.NVarChar, "new")
        .input("NewStatus", sql.NVarChar, "new")
        .input("ChangedBy", sql.UniqueIdentifier, UserId)
        .input("Reason", sql.NVarChar, null)
        .query(`
          INSERT INTO ReportStatusHistory
            (Id, ReportId, OldStatus, NewStatus, ChangedBy, Reason, ChangedAt)
          VALUES
            (NEWID(), @ReportId, @OldStatus, @NewStatus, @ChangedBy, @Reason, SYSDATETIME())
        `);
    } catch (_) {
      // تجاهل لو الجدول غير موجود
    }

    await tx.commit();

    return res.status(201).json({
      message: "تم إرسال البلاغ بنجاح ✅",
      reportId: ReportId,
    });
  } catch (err) {
    try {
      await tx.rollback();
    } catch {}
    console.error("CREATE REPORT ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};

// =======================
// GET /reports/my/:userId
// يرجّع DepartmentName + Media[]
// =======================
exports.getMyReports = async (req, res) => {
  const userId = String(req.params?.userId || "").trim();
  if (!isGuid(userId)) return res.status(400).json({ message: "userId غير صحيح" });

  try {
    const pool = await poolPromise;

    // 1) reports + department name
    const r1 = await pool
      .request()
      .input("UserId", sql.UniqueIdentifier, userId)
      .query(`
        SELECT
          R.Id,
          R.UserId,
          R.DepartmentId,
          D.Name AS DepartmentName,
          R.Description,
          R.LocationLat,
          R.LocationLng,
          R.Status,
          R.RejectionReason,
          R.CreatedAt,
          R.UpdatedAt,
          R.UpdatedBy
        FROM Reports R
        LEFT JOIN Departments D ON D.Id = R.DepartmentId
        WHERE R.UserId = @UserId
        ORDER BY R.CreatedAt DESC
      `);

    const reports = r1.recordset || [];
    if (!reports.length) return res.json([]);

    // 2) media لكل reports
    // نستخدم IN مع GUIDs بشكل آمن (بارامترات)
    const ids = reports.map((x) => x.Id).filter(Boolean);

    const req2 = pool.request();
    const placeholders = ids.map((_, i) => `@Id${i}`).join(", ");
    ids.forEach((id, i) => req2.input(`Id${i}`, sql.UniqueIdentifier, id));

    const r2 = await req2.query(`
      SELECT
        M.Id,
        M.ReportId,
        M.Type,
        M.FileUrl,
        M.CreatedAt
      FROM Media M
      WHERE M.ReportId IN (${placeholders})
      ORDER BY M.CreatedAt ASC
    `);

    const mediaRows = r2.recordset || [];
    const mediaByReport = new Map();
    for (const m of mediaRows) {
      const k = String(m.ReportId);
      if (!mediaByReport.has(k)) mediaByReport.set(k, []);
      mediaByReport.get(k).push(m);
    }

    const out = reports.map((rep) => ({
      ...rep,
      Media: mediaByReport.get(String(rep.Id)) || [],
    }));

    return res.json(out);
  } catch (err) {
    console.error("GET MY REPORTS ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};

// =======================
// GET /reports/department/:departmentId
// =======================
exports.getDepartmentReports = async (req, res) => {
  const departmentId = String(req.params?.departmentId || "").trim();
  if (!isGuid(departmentId)) return res.status(400).json({ message: "departmentId غير صحيح" });

  try {
    const pool = await poolPromise;

    const r1 = await pool
      .request()
      .input("DepartmentId", sql.UniqueIdentifier, departmentId)
      .query(`
        SELECT
          R.Id,
          R.UserId,
          R.DepartmentId,
          D.Name AS DepartmentName,
          R.Description,
          R.LocationLat,
          R.LocationLng,
          R.Status,
          R.RejectionReason,
          R.CreatedAt,
          R.UpdatedAt,
          R.UpdatedBy
        FROM Reports R
        LEFT JOIN Departments D ON D.Id = R.DepartmentId
        WHERE R.DepartmentId = @DepartmentId
        ORDER BY R.CreatedAt DESC
      `);

    const reports = r1.recordset || [];
    if (!reports.length) return res.json([]);

    const ids = reports.map((x) => x.Id).filter(Boolean);

    const req2 = pool.request();
    const placeholders = ids.map((_, i) => `@Id${i}`).join(", ");
    ids.forEach((id, i) => req2.input(`Id${i}`, sql.UniqueIdentifier, id));

    const r2 = await req2.query(`
      SELECT
        M.Id,
        M.ReportId,
        M.Type,
        M.FileUrl,
        M.CreatedAt
      FROM Media M
      WHERE M.ReportId IN (${placeholders})
      ORDER BY M.CreatedAt ASC
    `);

    const mediaRows = r2.recordset || [];
    const mediaByReport = new Map();
    for (const m of mediaRows) {
      const k = String(m.ReportId);
      if (!mediaByReport.has(k)) mediaByReport.set(k, []);
      mediaByReport.get(k).push(m);
    }

    const out = reports.map((rep) => ({
      ...rep,
      Media: mediaByReport.get(String(rep.Id)) || [],
    }));

    return res.json(out);
  } catch (err) {
    console.error("GET DEPARTMENT REPORTS ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};

// =======================
// PATCH /reports/:id/status
// body: { status, employeeId, reason? }
// =======================
exports.updateStatus = async (req, res) => {
  const id = String(req.params?.id || "").trim();
  const { status, employeeId, reason } = req.body || {};

  const Status = String(status || "").toLowerCase().trim();
  const EmployeeId = String(employeeId || "").trim();
  const Reason = normStr(reason) || null;

  if (!isGuid(id)) return res.status(400).json({ message: "Report id غير صحيح" });
  if (!ALLOWED_STATUS.has(Status)) return res.status(400).json({ message: "Status غير صحيح" });
  if (!isGuid(EmployeeId)) return res.status(400).json({ message: "employeeId غير صحيح" });

  let pool;
  const tx = new sql.Transaction();

  try {
    pool = await poolPromise;
    await tx.begin(pool);

    // اقرأ الحالة القديمة
    const r0 = await new sql.Request(tx)
      .input("Id", sql.UniqueIdentifier, id)
      .query(`SELECT TOP 1 Status FROM Reports WHERE Id = @Id`);

    const oldStatus = r0.recordset?.[0]?.Status || null;
    if (!oldStatus) {
      await tx.rollback();
      return res.status(404).json({ message: "البلاغ غير موجود" });
    }

    // حدّث البلاغ
    const upd = new sql.Request(tx);
    upd.input("Id", sql.UniqueIdentifier, id);
    upd.input("Status", sql.NVarChar, Status);
    upd.input("UpdatedBy", sql.UniqueIdentifier, EmployeeId);

    // لو rejected خزّن السبب
    const setReasonSql =
      Status === "rejected"
        ? ", RejectionReason = @Reason"
        : ", RejectionReason = NULL";

    if (Status === "rejected") {
      upd.input("Reason", sql.NVarChar, Reason || "—");
    }

    await upd.query(`
      UPDATE Reports
      SET Status = @Status,
          UpdatedAt = SYSDATETIME(),
          UpdatedBy = @UpdatedBy
          ${setReasonSql}
      WHERE Id = @Id
    `);

    // (اختياري) سجل في التاريخ
    try {
      await new sql.Request(tx)
        .input("ReportId", sql.UniqueIdentifier, id)
        .input("OldStatus", sql.NVarChar, String(oldStatus))
        .input("NewStatus", sql.NVarChar, Status)
        .input("ChangedBy", sql.UniqueIdentifier, EmployeeId)
        .input("Reason", sql.NVarChar, Status === "rejected" ? (Reason || "—") : null)
        .query(`
          INSERT INTO ReportStatusHistory
            (Id, ReportId, OldStatus, NewStatus, ChangedBy, Reason, ChangedAt)
          VALUES
            (NEWID(), @ReportId, @OldStatus, @NewStatus, @ChangedBy, @Reason, SYSDATETIME())
        `);
    } catch (_) {
      // تجاهل لو الجدول غير موجود
    }

    await tx.commit();
    return res.json({ message: "تم تحديث الحالة ✅" });
  } catch (err) {
    try {
      await tx.rollback();
    } catch {}
    console.error("UPDATE STATUS ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};
