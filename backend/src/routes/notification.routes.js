// backend/src/routes/notification.routes.js
const router = require("express").Router();
const n = require("../controllers/notification.controller");

router.get("/my/:userId", n.getMyNotifications);
router.patch("/:id/read", n.markRead);
router.patch("/my/:userId/read-all", n.markAllRead);

router.delete("/:id", n.removeOne);
router.delete("/my/:userId", n.clearAll);

module.exports = router;