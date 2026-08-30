const express = require("express");
const router = express.Router();
const Notification = require("../models/Notification");
const User = require("../models/User");
const verifyFirebaseToken = require("../middleware/auth");

// Get user's notifications
router.get("/", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const { page = 1, limit = 20, unreadOnly = false, includeExpired = false } = req.query;

    const query = { userId: user._id };
    if (unreadOnly === "true") {
      query.isRead = false;
    }
    // Hide stale notifications for already-attempted exams:
    // by default only show last 14 days and not-yet-expired. Prevents 5-10 old
    // exam_submitted rows reappearing on every login.
    if (includeExpired !== "true") {
      const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      query.createdAt = { $gte: cutoff };
      query.$or = [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }];
      // Merge $or with createdAt without overwriting
      const or = query.$or;
      delete query.$or;
      const createdAtCond = query.createdAt;
      delete query.createdAt;
      query.$and = [
        { createdAt: createdAtCond },
        { $or: or },
      ];
    }

    // Backfill: old docs created before TTL had no expiresAt — set it now so they age out
    await Notification.updateMany(
      { userId: user._id, expiresAt: null },
      [
        {
          $set: {
            expiresAt: {
              $add: ["$createdAt", 14 * 24 * 60 * 60 * 1000],
            },
          },
        },
      ],
    );

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Notification.countDocuments(query);
    const unreadCount = await Notification.countDocuments({
      userId: user._id,
      isRead: false,
    });

    res.json({
      notifications,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
      unreadCount,
    });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Mark notification as read
router.put("/:id/read", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: user._id },
      { isRead: true, readAt: new Date() },
      { new: true },
    );

    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }

    res.json({ notification });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Mark all notifications as read
router.put("/read-all", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    await Notification.updateMany(
      { userId: user._id, isRead: false },
      { isRead: true, readAt: new Date() },
    );

    res.json({ message: "All notifications marked as read" });
  } catch (error) {
    console.error("Error marking all notifications as read:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Delete a notification
router.delete("/:id", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      userId: user._id,
    });

    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }

    res.json({ message: "Notification deleted" });
  } catch (error) {
    console.error("Error deleting notification:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Create notification (internal use or admin)
router.post("/", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || !["admin", "super_admin", "coordinator"].includes(user.role)) {
      return res
        .status(403)
        .json({ message: "Not authorized to create notifications" });
    }

    const { userId, type, title, message, data, priority } = req.body;

    const notification = new Notification({
      userId,
      type,
      title,
      message,
      data,
      priority: priority || "medium",
    });

    await notification.save();
    res.status(201).json({ notification });
  } catch (error) {
    console.error("Error creating notification:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Send notification to multiple users (admin only)
router.post("/broadcast", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || !["admin", "super_admin"].includes(user.role)) {
      return res.status(403).json({ message: "Admin access required" });
    }

    const { userIds, role, type, title, message, priority } = req.body;

    let targetUsers;
    if (userIds && userIds.length > 0) {
      targetUsers = userIds;
    } else if (role) {
      const users = await User.find({ role });
      targetUsers = users.map((u) => u._id);
    } else {
      return res
        .status(400)
        .json({ message: "Specify userIds or role for broadcast" });
    }

    const notifications = targetUsers.map((userId) => ({
      userId,
      type: type || "system_announcement",
      title,
      message,
      priority: priority || "medium",
    }));

    await Notification.insertMany(notifications);
    res
      .status(201)
      .json({ message: `Notifications sent to ${targetUsers.length} users` });
  } catch (error) {
    console.error("Error broadcasting notifications:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
