// backend/src/controllers/report.controller.js
const sql = require("mssql");
const poolPromise = require("../../db");


const isGuid = (v) =>
  typeof v === "string" &&
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(v);

const normStr = (v) => String(v || "").trim();


const ALLOWED_STATUS = new Set(["new", "in_progress", "accepted", "rejected"]);

//  منع تكرار البلاغ خلال (ثواني)
const DEDUP_WINDOW_SECONDS = 45;
//  سماحية فرق الإحداثيات (تقريبًا متر إلى كم متر حسب المكان)
const COORD_EPS = 0.00005;

function normalizeMediaArray(media) {
  if (!Array.isArray(media)) return [];
  return media
    .map((m) => ({
      type: String(m?.type || m?.Type || "").toLowerCase(),
      fileUrl: String(m?.fileUrl || m?.FileUrl || "").trim(),
    }))
    .filter((m) => (m.type === "image" || m.type === "video") && !!m.fileUrl);
}

async function insertNotification(tx, { userId, reportId, type, title, message }) {
  try {
    const uid = String(userId || "").trim();
    const rid = reportId ? String(reportId).trim() : null;

    if (!isGuid(uid)) return;

    const req = new sql.Request(tx);
    req.input("UserId", sql.UniqueIdentifier, uid);
    req.input("ReportId", sql.UniqueIdentifier, isGuid(rid || "") ? rid : null);
    req.input("Type", sql.NVarChar(30), String(type || "info"));
    req.input("Title", sql.NVarChar(150), String(title || ""));
    req.input("Message", sql.NVarChar(sql.MAX), String(message || ""));

    await req.query(`
      INSERT INTO dbo.Notifications
        (Id, UserId, ReportId, Type, Title, Message, IsRead, CreatedAt)
      VALUES
        (NEWID(), @UserId, @ReportId, @Type, @Title, @Message, 0, SYSDATETIME())
    `);
  } catch (err) {
    console.log("Notification insert skipped:", err.message);
  }
}


async function insertStatusHistory(tx, { reportId, changedBy, fromStatus, toStatus, note = null }) {
  try {
    if (!isGuid(String(reportId || "")) || !isGuid(String(changedBy || ""))) return;

    await new sql.Request(tx)
      .input("ReportId", sql.UniqueIdentifier, reportId)
      .input("ChangedBy", sql.UniqueIdentifier, changedBy)
      .input("FromStatus", sql.NVarChar(20), String(fromStatus || "").trim().toLowerCase())
      .input("ToStatus", sql.NVarChar(20), String(toStatus || "").trim().toLowerCase())
      .input("Note", sql.NVarChar(sql.MAX), note ? String(note) : null)
      .query(`
        INSERT INTO dbo.ReportStatusHistory
          (Id, ReportId, ChangedBy, FromStatus, ToStatus, Note, ChangedAt)
        VALUES
          (NEWID(), @ReportId, @ChangedBy, @FromStatus, @ToStatus, @Note, SYSDATETIME())
      `);
  } catch (_) {
   
  }
}

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

  let tx;

  try {
    const pool = await poolPromise;

    tx = new sql.Transaction(pool);
    await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

    // ==========================================
    //  0) منع تكرار البلاغ (Dedup)
    // نفس المستخدم + نفس الجهة + وصف مطابق + إحداثيات قريبة + خلال نافذة زمنية قصيرة
    // ==========================================
    const dup = await new sql.Request(tx)
      .input("UserId", sql.UniqueIdentifier, UserId)
      .input("DepartmentId", sql.UniqueIdentifier, DepartmentId)
      .input("Description", sql.NVarChar(sql.MAX), Description)
      .input("Lat", sql.Float, Lat)
      .input("Lng", sql.Float, Lng)
      .input("Eps", sql.Float, COORD_EPS)
      .input("Win", sql.Int, DEDUP_WINDOW_SECONDS)
      .query(`
        SELECT TOP 1 Id AS ReportId
        FROM dbo.Reports
        WHERE UserId = @UserId
          AND DepartmentId = @DepartmentId
          AND LTRIM(RTRIM(Description)) = LTRIM(RTRIM(@Description))
          AND ABS(LocationLat - @Lat) <= @Eps
          AND ABS(LocationLng - @Lng) <= @Eps
          AND DATEDIFF(SECOND, CreatedAt, SYSDATETIME()) BETWEEN 0 AND @Win
        ORDER BY CreatedAt DESC
      `);

    const existingId = dup?.recordset?.[0]?.ReportId;
    if (existingId) {
      //  رجّع نفس البلاغ بدل إنشاء جديد
      await tx.commit();
      return res.status(200).json({
        message: "تم استلام البلاغ مسبقًا (منع تكرار الإرسال)",
        reportId: existingId,
        dedup: true,
      });
    }

    // ==========================================
    //  1) إنشاء البلاغ
    // ==========================================
    const insertReportResult = await new sql.Request(tx)
      .input("UserId", sql.UniqueIdentifier, UserId)
      .input("DepartmentId", sql.UniqueIdentifier, DepartmentId)
      .input("Description", sql.NVarChar(sql.MAX), Description)
      .input("Lat", sql.Float, Lat)
      .input("Lng", sql.Float, Lng)
      .query(`
        INSERT INTO dbo.Reports
          (Id, UserId, DepartmentId, Description, LocationLat, LocationLng, Status, CreatedAt)
        OUTPUT INSERTED.Id AS ReportId
        VALUES
          (NEWID(), @UserId, @DepartmentId, @Description, @Lat, @Lng, 'new', SYSDATETIME())
      `);

    const ReportId = insertReportResult?.recordset?.[0]?.ReportId;
    if (!ReportId) throw new Error("فشل إنشاء البلاغ");

    // ==========================================
    //  2) المرفقات
    // ==========================================
    if (MediaList.length) {
      for (const m of MediaList) {
        await new sql.Request(tx)
          .input("ReportId", sql.UniqueIdentifier, ReportId)
          .input("Type", sql.NVarChar(20), m.type)
          .input("FileUrl", sql.NVarChar(sql.MAX), m.fileUrl)
          .query(`
            INSERT INTO dbo.Media
              (Id, ReportId, Type, FileUrl, CreatedAt)
            VALUES
              (NEWID(), @ReportId, @Type, @FileUrl, SYSDATETIME())
          `);
      }
    }

    
    await insertStatusHistory(tx, {
      reportId: ReportId,
      changedBy: UserId,
      fromStatus: "new",
      toStatus: "new",
      note: null,
    });

    // ==========================================
    // ✅ 4) إشعار "تم استلام البلاغ"
    // ==========================================
    await insertNotification(tx, {
      userId: UserId,
      reportId: ReportId,
      type: "report_created",
      title: "تم استلام البلاغ",
      message: "تم إرسال البلاغ بنجاح وسيتم مراجعته قريباً",
    });

    await tx.commit();

    return res.status(201).json({
      message: "تم إرسال البلاغ بنجاح",
      reportId: ReportId,
    });
  } catch (err) {
    try {
      if (tx) await tx.rollback();
    } catch {}
    console.error("CREATE REPORT ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};

exports.getMyReports = async (req, res) => {
  const userId = String(req.params?.userId || "").trim();
  if (!isGuid(userId)) return res.status(400).json({ message: "userId غير صحيح" });

  try {
    const pool = await poolPromise;

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
           R.CreatedAt,
          R.UpdatedAt,
          R.UpdatedBy
        FROM dbo.Reports R
        LEFT JOIN dbo.Departments D ON D.Id = R.DepartmentId
        WHERE R.UserId = @UserId
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
      FROM dbo.Media M
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
          R.CreatedAt,
          R.UpdatedAt,
          R.UpdatedBy
        FROM dbo.Reports R
        LEFT JOIN dbo.Departments D ON D.Id = R.DepartmentId
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
      FROM dbo.Media M
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


exports.updateStatus = async (req, res) => {
  const id = String(req.params?.id || "").trim();
  const { status, employeeId } = req.body || {};

  const Status = String(status || "").toLowerCase().trim();
  const EmployeeId = String(employeeId || "").trim();

  if (!isGuid(id)) return res.status(400).json({ message: "Report id غير صحيح" });
  if (!ALLOWED_STATUS.has(Status)) return res.status(400).json({ message: "Status غير صحيح" });
  if (!isGuid(EmployeeId)) return res.status(400).json({ message: "employeeId غير صحيح" });

  let tx;

  try {
    const pool = await poolPromise;

    tx = new sql.Transaction(pool);
    await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

    const r0 = await new sql.Request(tx)
      .input("Id", sql.UniqueIdentifier, id)
      .query(`SELECT TOP 1 Status, UserId FROM dbo.Reports WHERE Id = @Id`);

    const oldStatus = r0.recordset?.[0]?.Status || null;
    const reportOwnerId = r0.recordset?.[0]?.UserId ? String(r0.recordset[0].UserId) : null;

    if (!oldStatus) {
      await tx.rollback();
      return res.status(404).json({ message: "البلاغ غير موجود" });
    }

    await new sql.Request(tx)
      .input("Id", sql.UniqueIdentifier, id)
      .input("Status", sql.NVarChar(20), Status)
      .input("UpdatedBy", sql.UniqueIdentifier, EmployeeId)
      .query(`
        UPDATE dbo.Reports
        SET Status = @Status,
            UpdatedAt = SYSDATETIME(),
            UpdatedBy = @UpdatedBy
        WHERE Id = @Id
      `);

    
    await insertStatusHistory(tx, {
      reportId: id,
      changedBy: EmployeeId,
      fromStatus: String(oldStatus || "").trim().toLowerCase(),
      toStatus: Status,
      note: null,
    });

    // إشعار لصاحب البلاغ
    if (reportOwnerId && isGuid(reportOwnerId)) {
      let title = "تحديث حالة البلاغ";
      let message = "تم تحديث حالة البلاغ";

      if (Status === "accepted") {
        title = "تم حل البلاغ ";
        message = "تمت معالجة البلاغ بنجاح";
      } else if (Status === "rejected") {
        title = "تم رفض البلاغ ";
        message = "تم رفض البلاغ من الجهة المختصة";
      } else if (Status === "in_progress") {
        title = "جاري معالجة البلاغ ⏳";
        message = "تم البدء في معالجة البلاغ";
      }

      await insertNotification(tx, {
        userId: reportOwnerId,
        reportId: id,
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
    console.error("UPDATE STATUS ERROR:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
};