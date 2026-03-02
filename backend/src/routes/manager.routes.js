const router = require("express").Router();
const manager = require("../controllers/manager.controller");
const { requireAuth, requireRole } = require("../middleware/auth");

router.use(requireAuth, requireRole("manager"));

// الموظفين
router.get("/employees", manager.listEmployees);
router.post("/employees", manager.createEmployee);
router.delete("/employees/:userId", manager.disableEmployee);

// البلاغات
router.get("/reports", manager.listReports);
router.get("/reports/:id", manager.getReportDetails);

// الإحصائيات
router.get("/stats", manager.getStats);

module.exports = router;