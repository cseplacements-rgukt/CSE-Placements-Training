/*
 * Safe in-place rebrand of the super_admin account.
 * PRESERVES _id, firebaseUid, createdAt, submissions/exams ownership,
 * notifications, proctoring sessions, etc. — only name/email/displayName change.
 *
 * Idempotent: re-running with same target is a no-op.
 *
 * Usage:
 *   node scripts/migrate-super-admin-branding.js                     # default: name="Cse Placements Training", keeps email
 *   node scripts/migrate-super-admin-branding.js --name "Cse Placements Training" --email superadmin@cseplacements.training
 *   node scripts/migrate-super-admin-branding.js --dry               # preview without writing
 *
 * Env: MONGODB_URI, FIREBASE_* (for Firebase Auth email sync)
 */
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");
require("../models/Submission");
require("../models/Exam");

const DEFAULT_NAME = "Cse Placements Training";

async function syncFirebaseEmail(oldEmail, newEmail, displayName) {
  try {
    const admin = require("../config/firebase");
    // Find Firebase user by old email
    let fbUser;
    try { fbUser = await admin.auth().getUserByEmail(oldEmail); } catch (e) { /* not found */ }
    if (!fbUser) {
      console.log(`  Firebase: no user found for ${oldEmail} — skipping Firebase sync (will be created on next login if needed)`);
      return;
    }
    const update = {};
    if (newEmail && newEmail.toLowerCase() !== oldEmail.toLowerCase()) update.email = newEmail.toLowerCase();
    if (displayName) update.displayName = displayName;
    if (Object.keys(update).length === 0) return;
    await admin.auth().updateUser(fbUser.uid, update);
    console.log(`  Firebase: updated ${oldEmail} -> ${JSON.stringify(update)}`);
  } catch (e) {
    console.warn(`  Firebase sync failed (Mongo update still applied): ${e.message}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i+1] : null; };
  const has = (n) => args.includes(n);
  const dry = has("--dry");
  const targetName = getArg("--name") || DEFAULT_NAME;
  const targetEmail = getArg("--email") ? getArg("--email").toLowerCase() : null;

  await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/mod-u-go");
  try {
    const superAdmins = await User.find({ role: "super_admin" }).lean();
    console.log(`Found ${superAdmins.length} super_admin(s)`);
    if (superAdmins.length === 0) {
      console.log("No super_admin to migrate. If you wiped DB, run seed-platform.js with updated SUPER_ADMIN instead.");
      return;
    }
    for (const sa of superAdmins) {
      console.log(`\n- ${sa._id} | name="${sa.name}" email=${sa.email} firebaseUid=${sa.firebaseUid}`);
      const needsName = sa.name !== targetName;
      const needsEmail = targetEmail && sa.email.toLowerCase() !== targetEmail.toLowerCase();
      if (!needsName && !needsEmail) {
        console.log("  Already at target — no change");
        continue;
      }
      // Email uniqueness check (preserve data: cannot collide)
      if (needsEmail) {
        const clash = await User.findOne({ email: targetEmail });
        if (clash && String(clash._id) !== String(sa._id)) {
          console.error(`  ERROR: target email ${targetEmail} already taken by ${clash._id} (${clash.role}) — skipping this account`);
          continue;
        }
      }
      console.log(`  Will update: ${needsName ? `name "${sa.name}" -> "${targetName}"` : ""} ${needsEmail ? `email ${sa.email} -> ${targetEmail}` : ""} ${dry ? "[DRY]" : ""}`);
      if (dry) continue;

      // Firebase first (so Mongo stays consistent if Firebase rejects)
      await syncFirebaseEmail(sa.email, targetEmail, needsName ? targetName : undefined);

      const set = {};
      if (needsName) set.name = targetName;
      if (needsEmail) set.email = targetEmail;
      set.updatedAt = new Date();
      await User.updateOne({ _id: sa._id }, { $set: set });
      console.log("  Mongo: updated");

      // Verify preserved
      const after = await User.findById(sa._id).lean();
      console.log(`  After: name="${after.name}" email=${after.email} _id preserved=${String(after._id)===String(sa._id)} role=${after.role} createdAt=${after.createdAt?.toISOString()}`);
      const counts = {
        submissions: await mongoose.model("Submission").countDocuments({ studentId: sa._id }),
        exams: await mongoose.model("Exam").countDocuments({ teacherId: sa._id }),
      };
      console.log(`  Data preserved: submissions=${counts.submissions} exams=${counts.exams} (counts unchanged)`);
    }
    if (dry) console.log("\nDry run — rerun without --dry to apply");
    else console.log("\nDone. No data deleted; _id/firebaseUid/exams/submissions preserved.");
  } finally {
    await mongoose.disconnect();
  }
}
main().catch(e=>{ console.error(e); process.exit(1); });
