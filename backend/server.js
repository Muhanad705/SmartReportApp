// backend/server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const authRoutes = require("./src/routes/auth.routes");
const departmentRoutes = require("./src/routes/department.routes");
const uploadRoutes = require("./src/routes/upload.routes");
const reportRoutes = require("./src/routes/report.routes");
const notificationRoutes = require("./src/routes/notification.routes");
const adminRoutes = require("./src/routes/admin.routes"); 
const managerRoutes = require("./src/routes/manager.routes");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

 app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use("/api/auth", authRoutes);
app.use("/api/departments", departmentRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/admin", adminRoutes); 
app.use("/api/manager", managerRoutes);

app.get("/", (_, res) => res.send("API is running ✅"));

const PORT = process.env.PORT || 4000;
 app.listen(PORT, () => console.log(`✅ API running on http://localhost:${PORT}`));