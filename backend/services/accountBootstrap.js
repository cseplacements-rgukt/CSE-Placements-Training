/*
 * Firebase account bootstrap helpers for out-of-band scripts (super-admin
 * seeding, post-reset repair). NOT used by normal request flow — routes go
 * through services/staffProvisioning.js instead.
 */
const firebaseAdmin = require("../config/firebase");
const { generateTempPassword } = require("./staffProvisioning");

/**
 * Returns an existing Firebase Auth user for the email, or creates one.
 * When the user already exists their password is rotated to a fresh temp
 * password so operators can always hand out working credentials after a
 * Firebase project reset.
 *
 * @returns {Promise<{firebaseUid: string, tempPassword: string|null, created: boolean}>}
 */
async function getOrCreateFirebaseUser({ email, displayName, password }) {
  const resolvePassword = () =>
    typeof password === "string" && password.trim()
      ? password.trim()
      : generateTempPassword();
  try {
    const existing = await firebaseAdmin.auth().getUserByEmail(email);
    // Rotate the password so a wiped/unknown credential state still yields
    // a known-good login for whoever runs this script.
    const tempPassword = resolvePassword();
    await firebaseAdmin.auth().updateUser(existing.uid, {
      password: tempPassword,
      displayName: displayName || existing.displayName,
      disabled: false,
    });
    return { firebaseUid: existing.uid, tempPassword, created: false };
  } catch (error) {
    if (error?.code !== "auth/user-not-found") throw error;
    const tempPassword = resolvePassword();
    const created = await firebaseAdmin.auth().createUser({
      email,
      password: tempPassword,
      displayName: displayName || undefined,
    });
    return { firebaseUid: created.uid, tempPassword, created: true };
  }
}

module.exports = { getOrCreateFirebaseUser };
