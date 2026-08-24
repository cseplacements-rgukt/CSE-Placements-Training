/*
 * Out-of-band bootstrap utilities for a real deployment. These commands are
 * intentionally local-only; public login requests must never be able to
 * promote themselves. The first super_admin is seeded once at deployment;
 * after that, all staff management happens in the admin UI.
 *
 * Seed (or repair) the very first super admin — creates the Firebase Auth
 * user via the Admin SDK when missing, rotates its password otherwise, and
 * upserts the local super_admin document:
 *   node scripts/promote-user-role.js --seed-super-admin <email> ["Full Name"]
 *
 * The generated temp password is printed ONCE to stdout.
 *
 * Promote an existing local account (no Firebase changes):
 *   node scripts/promote-user-role.js <email> <student|coordinator|admin|super_admin>
 */
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");
const { getOrCreateFirebaseUser } = require("../services/accountBootstrap");

const [, , arg1, arg2, arg3] = process.argv;
const validRoles = new Set(["student", "coordinator", "admin", "super_admin"]);

async function main() {
  await mongoose.connect(
    process.env.MONGODB_URI || "mongodb://localhost:27017/mod-u-go",
  );

  if (arg1 === "--seed-super-admin") {
    const email = String(arg2 || "").trim().toLowerCase();
    const name = arg3 || "Super Admin";
    if (!email || !email.includes("@")) {
      console.error(
        'Usage: node scripts/promote-user-role.js --seed-super-admin <email> ["Full Name"]',
      );
      process.exitCode = 1;
      return;
    }

    // Creates the Firebase login if absent; rotates the password if present
    // so the operator always gets a working credential.
    const { firebaseUid, tempPassword, created } =
      await getOrCreateFirebaseUser({ email, displayName: name });

    const user = await User.findOneAndUpdate(
      { email },
      {
        email,
        name,
        role: "super_admin",
        firebaseUid, // repairs stale UIDs left behind by a Firebase reset
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    ).select("email name role firebaseUid");

    console.log(`Super admin ready: ${user.email} (${user.name})`);
    console.log(
      created
        ? "Firebase Auth account: newly created."
        : "Firebase Auth account: already existed — password was ROTATED.",
    );
    console.log(`\n  Email:    ${user.email}`);
    console.log(`  Password: ${tempPassword}   (shown once — store it now)\n`);
    return;
  }

  const email = arg1;
  const role = arg2;
  if (!email || !validRoles.has(role)) {
    console.error(
      "Usage: node scripts/promote-user-role.js <email> <student|coordinator|admin|super_admin>",
    );
    console.error(
      '       node scripts/promote-user-role.js --seed-super-admin <email> ["Full Name"]',
    );
    process.exitCode = 1;
    return;
  }

  const user = await User.findOneAndUpdate(
    { email: email.toLowerCase() },
    { role },
    { new: true, runValidators: true },
  ).select("email name role");
  if (!user) {
    console.error(`No account found for ${email}`);
    process.exitCode = 1;
    return;
  }
  console.log(`${user.email} is now ${user.role}`);
}

main()
  .catch((err) => {
    console.error("Failed:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
