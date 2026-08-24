/*
 * Staff account provisioning — THE single creation path for staff accounts.
 * Used by the /api/staff routes and by the seed/bootstrap scripts so they can
 * never drift from what the real app does: validate → provision the Firebase
 * Auth login with a temporary password → create the local User document →
 * send a welcome notification.
 */
const User = require("../models/User");
const Notification = require("../models/Notification");
const firebaseAdmin = require("../config/firebase");
const { STAFF_ROLES } = require("../utils/roles");
const crypto = require("crypto");

const generateTempPassword = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(10);
  let out = "";
  for (let i = 0; i < 10; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
};

class ProvisionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Creates a staff login end-to-end.
 * @returns {Promise<{user, tempPassword}>}
 */
async function provisionStaffAccount({ name, email, role, actorName, password }) {
  const trimmedEmail = String(email || "").trim().toLowerCase();

  if (!String(name || "").trim()) {
    throw new ProvisionError(400, "Name is required");
  }
  if (!trimmedEmail || !trimmedEmail.includes("@")) {
    throw new ProvisionError(400, "A valid email is required");
  }
  if (!STAFF_ROLES.includes(role)) {
    throw new ProvisionError(
      403,
      `Role must be one of: ${STAFF_ROLES.join(", ")}`,
    );
  }

  const existingMongo = await User.findOne({ email: trimmedEmail });
  if (existingMongo) {
    throw new ProvisionError(
      409,
      "An account with this email already exists",
    );
  }

  // Provision the Firebase Auth account with a temporary password the
  // creating admin hands to the new staff member.
  let tempPassword;
  let firebaseUid;
  try {
    tempPassword =
      typeof password === "string" && password.trim()
        ? password.trim()
        : generateTempPassword();
    const fbUser = await firebaseAdmin.auth().createUser({
      email: trimmedEmail,
      password: tempPassword,
      displayName: String(name).trim(),
    });
    firebaseUid = fbUser.uid;
  } catch (fbError) {
    if (
      fbError?.code === "auth/email-already-exists" ||
      fbError?.errorInfo?.message?.includes("email")
    ) {
      throw new ProvisionError(
        409,
        "This email is already registered in Firebase. Ask them to sign in instead.",
      );
    }
    console.error("Firebase user creation failed:", fbError);
    throw new ProvisionError(
      500,
      "Could not provision the login account (Firebase). Verify Firebase Admin credentials and try again.",
    );
  }

  const user = await User.create({
    firebaseUid,
    email: trimmedEmail,
    name: String(name).trim(),
    role,
  });

  await Notification.create({
    userId: user._id,
    type: "account_update",
    title: "Welcome to MOD-U-GO",
    message: `Your ${role} account was created by ${
      actorName || "an administrator"
    }. Sign in with the temporary password you were given.`,
    priority: "high",
  });

  return { user, tempPassword };
}

module.exports = {
  provisionStaffAccount,
  generateTempPassword,
  ProvisionError,
};
