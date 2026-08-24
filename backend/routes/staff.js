const express = require("express");
const router = express.Router();
const User = require("../models/User");
const Exam = require("../models/Exam");
const Submission = require("../models/Submission");
const ProctoringSession = require("../models/ProctoringSession");
const Notification = require("../models/Notification");
const firebaseAdmin = require("../config/firebase");
const verifyFirebaseToken = require("../middleware/auth");
const {
  provisionStaffAccount,
  validateStaffPassword,
  ProvisionError,
} = require("../services/staffProvisioning");

// Staff account provisioning. Roles:
//   • super_admin — creates/manages admin + coordinator accounts
//   • admin       — creates/manages coordinator accounts only
// Staff sign in with Firebase email/password; their accounts are created
// here (Firebase Admin SDK + Mongo doc in one step), never via public
// self-signup.
const requireStaffManager = async (req, res, next) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || !["admin", "super_admin"].includes(user.role)) {
      return res.status(403).json({ message: "Admin access required" });
    }
    req.managerUser = user;
    next();
  } catch (error) {
    console.error("Error in requireStaffManager:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Which target roles the caller may act on.
const manageableRolesFor = (managerRole) =>
  managerRole === "super_admin" ? ["admin", "coordinator"] : ["coordinator"];

async function loadTarget(req, res) {
  const target = await User.findById(req.params.id);
  if (!target || target.role === "student") {
    res.status(404).json({ message: "Staff account not found" });
    return null;
  }
  if (target.role === "super_admin") {
    res.status(403).json({
      message: "Super admin accounts are managed out-of-band",
    });
    return null;
  }
  if (!manageableRolesFor(req.managerUser.role).includes(target.role)) {
    res.status(403).json({
      message: `You can only manage ${manageableRolesFor(
        req.managerUser.role,
      ).join("/")} accounts`,
    });
    return null;
  }
  return target;
}

// ─── List staff accounts ─────────────────────────────────────────────
router.get("/users", verifyFirebaseToken, requireStaffManager, async (req, res) => {
  try {
    const { role, search } = req.query;
    const allowed = manageableRolesFor(req.managerUser.role);

    const query = { role: { $in: allowed } };
    if (role && allowed.includes(role)) query.role = role;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    const users = await User.find(query)
      .select("-twoFactorSecret")
      .sort({ createdAt: -1 })
      .limit(200);

    res.json({ users, total: users.length });
  } catch (error) {
    console.error("Error listing staff:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ─── Create a staff account (provisioned, not self-serve) ────────────
router.post("/", verifyFirebaseToken, requireStaffManager, async (req, res) => {
  try {
    const { name, email, role, password } = req.body;

    // Role hierarchy: admins create coordinators only; super_admins also
    // create admins. Enforced here before the shared provisioning service.
    const allowedRoles = manageableRolesFor(req.managerUser.role);
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({
        message: `You can create ${allowedRoles.join("/")} accounts only`,
      });
    }

    // The creating admin picks the starting password; it is only generated
    // randomly when none is supplied (e.g. seed scripts).
    const chosenPassword = password ? validateStaffPassword(password) : undefined;

    const { user, tempPassword } = await provisionStaffAccount({
      name,
      email,
      role,
      actorName: req.managerUser.name,
      password: chosenPassword,
    });

    res.status(201).json({
      user,
      tempPassword,
      message: `${role} account created. Share the password securely so they can sign in — they can change it after logging in.`,
    });
  } catch (error) {
    if (error instanceof ProvisionError || error.status) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error("Error creating staff:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ─── Reset a staff member's password (admin action) ──────────────────
router.put(
  "/:id/password",
  verifyFirebaseToken,
  requireStaffManager,
  async (req, res) => {
    try {
      const target = await loadTarget(req, res);
      if (!target) return;

      let newPassword;
      try {
        newPassword = validateStaffPassword(req.body.password);
      } catch (err) {
        return res.status(400).json({ message: err.message });
      }

      if (target._id.toString() === req.managerUser._id.toString()) {
        return res.status(400).json({
          message:
            "Use 'Change Password' from the Account menu to update your own password",
        });
      }

      try {
        await firebaseAdmin
          .auth()
          .updateUser(target.firebaseUid, { password: newPassword });
      } catch (fbError) {
        console.error("Firebase password reset failed:", fbError);
        return res.status(502).json({
          message:
            "Could not reset the password in Firebase. Verify Firebase Admin credentials and try again.",
        });
      }

      await Notification.create({
        userId: target._id,
        type: "account_update",
        title: "Password Reset",
        message: `Your password was reset by ${req.managerUser.name}. Sign in with the new password you were given and change it after logging in.`,
        priority: "high",
      });

      res.json({
        message: `Password reset for ${target.name}. Share it securely — they can change it after signing in.`,
      });
    } catch (error) {
      console.error("Error resetting staff password:", error);
      res.status(500).json({ message: "Server error", error: error.message });
    }
  },
);

// ─── Rename / activate / deactivate a staff account ──────────────────
router.put("/:id", verifyFirebaseToken, requireStaffManager, async (req, res) => {
  try {
    const target = await loadTarget(req, res);
    if (!target) return;

    const { name, isActive } = req.body;
    const updateData = {};
    if (name) updateData.name = String(name).trim();
    if (isActive !== undefined) updateData.isActive = isActive;

    const user = await User.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
    }).select("-twoFactorSecret");

    if (isActive !== undefined && isActive !== target.isActive) {
      await Notification.create({
        userId: user._id,
        type: "account_update",
        title: isActive ? "Account re-enabled" : "Account deactivated",
        message: isActive
          ? "Your account has been re-enabled by an administrator."
          : "Your account has been deactivated by an administrator.",
        priority: "high",
      });
    }

    res.json({ user, message: "Staff account updated" });
  } catch (error) {
    console.error("Error updating staff:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ─── Change a staff member's tier (super_admin only) ─────────────────
router.put(
  "/:id/role",
  verifyFirebaseToken,
  requireStaffManager,
  async (req, res) => {
    try {
      if (req.managerUser.role !== "super_admin") {
        return res
          .status(403)
          .json({ message: "Only a super admin can change staff tiers" });
      }

      const { role } = req.body;
      if (!["admin", "coordinator"].includes(role)) {
        return res.status(400).json({
          message: "Tier changes are limited to admin and coordinator",
        });
      }

      const target = await loadTarget(req, res);
      if (!target) return;

      if (target._id.toString() === req.managerUser._id.toString()) {
        return res
          .status(400)
          .json({ message: "You cannot change your own tier" });
      }

      target.role = role;
      await target.save();

      await Notification.create({
        userId: target._id,
        type: "account_update",
        title: "Role Updated",
        message: `Your account tier has been changed to ${role}`,
        priority: "high",
      });

      res.json({
        user: target,
        message: `Account tier updated to ${role}`,
      });
    } catch (error) {
      console.error("Error changing staff tier:", error);
      res.status(500).json({ message: "Server error", error: error.message });
    }
  },
);

// ─── Remove a staff account (super_admin exclusive) ──────────────────
router.delete(
  "/:id",
  verifyFirebaseToken,
  requireStaffManager,
  async (req, res) => {
    try {
      // Deletion is destructive across exams/submissions — super_admin only.
      if (req.managerUser.role !== "super_admin") {
        return res.status(403).json({
          message:
            "Only a super admin can delete staff accounts. Deactivate instead.",
        });
      }

      const target = await loadTarget(req, res);
      if (!target) return;

      if (target._id.toString() === req.managerUser._id.toString()) {
        return res
          .status(400)
          .json({ message: "Cannot delete your own account" });
      }

      // Cascade mirrors DELETE /api/admin/users/:id so no orphaned data is
      // left behind.
      await Submission.deleteMany({ studentId: target._id });
      await Exam.deleteMany({ teacherId: target._id });
      await Notification.deleteMany({ userId: target._id });
      await ProctoringSession.deleteMany({ studentId: target._id });
      await User.findByIdAndDelete(target._id);

      // Best-effort Firebase cleanup; Mongo state is authoritative.
      try {
        await firebaseAdmin.auth().deleteUser(target.firebaseUid);
      } catch (fbError) {
        console.warn(
          "Firebase deletion skipped:",
          fbError?.message || fbError,
        );
      }

      res.json({ message: `${target.name} and associated data deleted` });
    } catch (error) {
      console.error("Error deleting staff:", error);
      res.status(500).json({ message: "Server error", error: error.message });
    }
  },
);

module.exports = router;
