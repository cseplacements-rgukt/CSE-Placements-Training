/*
 * One-shot platform seeder for a fresh deployment or after a full account
 * wipe (e.g. Firebase Auth project reset). Idempotent — safe to re-run;
 * existing accounts are skipped (or repaired when their Firebase identity
 * went stale), never duplicated.
 *
 *   node scripts/seed-platform.js
 *
 * What it does, in order:
 *   1. Remaps any legacy role:"proctor" documents to coordinator (role was
 *      retired; see models/User.js ROLE_ALIASES).
 *   2. Ensures exactly one super_admin (creates the Firebase Auth user via
 *      the Admin SDK when missing; rotates its password otherwise).
 *   3. Seeds demo admins + coordinators through THE SAME provisioning path
 *      the /api/staff route uses (services/staffProvisioning.js) — Firebase
 *      user + local doc + welcome notification, not raw inserts.
 *   4. Seeds test students through the roster service used by /api/students.
 *   5. Sets the shared exam-cell password to a known test value.
 *   6. Prints every credential once.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");
const {
  provisionStaffAccount,
  ProvisionError,
} = require("../services/staffProvisioning");
const {
  addStudentToRoster,
  RosterError,
} = require("../services/studentRoster");
const { getOrCreateFirebaseUser } = require("../services/accountBootstrap");
const { ROLE_ALIASES } = require("../models/User");

// Simple shared password handed to every seeded staff account (super admin,
// admins, coordinators). Firebase's minimum password length is 6 chars.
const STAFF_PASSWORD = "123456";

const SUPER_ADMIN = {
  name: "Dr. Anitha Rao",
  email: "owner@modugo.test",
};
const ADMINS = [
  { name: "Ravi Kumar", email: "admin1@modugo.test", role: "admin" },
  { name: "Sunitha Devi", email: "admin2@modugo.test", role: "admin" },
  { name: "Kiran Raj", email: "admin3@modugo.test", role: "admin" },
];
const COORDINATORS = [
  { name: "Priya Sharma", email: "coord1@modugo.test", role: "coordinator" },
  { name: "Arjun Reddy", email: "coord2@modugo.test", role: "coordinator" },
  { name: "Meena Iyer", email: "coord3@modugo.test", role: "coordinator" },
];
// Demo students with their college exam-cell passwords hardcoded — in real
// use the placement cell imports the actual issued passwords via CSV.
const STUDENTS = [
  { idNumber: "S260101", name: "Lakshmi Prasanna", batchYear: 2026, password: "LX4PQ" },
  { idNumber: "S260102", name: "Vamshi Krishna", batchYear: 2026, password: "VK7RM" },
  { idNumber: "S260103", name: "Harika Chowdary", batchYear: 2026, password: "HC2NT" },
];

const credentials = [];
const notes = [];

async function seedSuperAdmin() {
  const email = SUPER_ADMIN.email;
  const existingDoc = await User.findOne({ email });

  // Fresh provision through the standard service first (real path).
  try {
    const { user, tempPassword } = await provisionStaffAccount({
      ...SUPER_ADMIN,
      role: "super_admin",
      actorName: "platform bootstrap",
      password: STAFF_PASSWORD,
    });
    credentials.push(["super_admin", user.email, tempPassword]);
    return;
  } catch (error) {
    if (!(error instanceof ProvisionError && error.status === 409)) {
      throw error;
    }
  }

  // Account already exists locally or in Firebase — repair the link, or
  // create the missing local doc when only the Firebase identity survives.
  const { firebaseUid, tempPassword, created } = await getOrCreateFirebaseUser({
    email,
    displayName: SUPER_ADMIN.name,
    password: STAFF_PASSWORD,
  });
  if (existingDoc) {
    await User.updateOne(
      { _id: existingDoc._id },
      { $set: { firebaseUid, role: "super_admin" } },
    );
    notes.push(
      `super_admin ${email}: local doc existed — Firebase link ${
        created ? "created" : "repaired (password rotated)"
      }.`,
    );
  } else {
    await User.create({
      firebaseUid,
      email,
      name: SUPER_ADMIN.name,
      role: "super_admin",
    });
    notes.push(
      `super_admin ${email}: Firebase account pre-existed — created local doc.`,
    );
  }
  credentials.push(["super_admin", email, tempPassword]);
}

async function seedStaff(list, label) {
  for (const spec of list) {
    const existingDoc = await User.findOne({ email: spec.email });
    try {
      const { user, tempPassword } = await provisionStaffAccount({
        ...spec,
        actorName: "platform bootstrap",
        password: STAFF_PASSWORD,
      });
      credentials.push([`${label}/${spec.role}`, user.email, tempPassword]);
    } catch (error) {
      if (error instanceof ProvisionError && error.status === 409) {
        // Repair-after-reset path: reuse the local doc when it exists,
        // otherwise create one for the surviving Firebase identity.
        const { firebaseUid, tempPassword } = await getOrCreateFirebaseUser({
          email: spec.email,
          displayName: spec.name,
          password: STAFF_PASSWORD,
        });
        if (existingDoc) {
          await User.updateOne(
            { _id: existingDoc._id },
            { $set: { firebaseUid, role: spec.role, isActive: true } },
          );
          notes.push(`${label} ${spec.email}: repaired stale Firebase link.`);
        } else {
          await User.create({
            firebaseUid,
            email: spec.email,
            name: spec.name,
            role: spec.role,
            isActive: true,
          });
          notes.push(
            `${label} ${spec.email}: Firebase account pre-existed — created local doc.`,
          );
        }
        credentials.push([`${label}/${spec.role}`, spec.email, tempPassword]);
      } else {
        throw error;
      }
    }
  }
}

async function seedStudents() {
  for (const spec of STUDENTS) {
    try {
      const student = await addStudentToRoster(spec);
      notes.push(
        `student ${student.idNumber}: roster email ${student.email}`,
      );
      credentials.push(["student", student.email, spec.password]);
    } catch (error) {
      if (error instanceof RosterError && error.status === 409) {
        notes.push(
          `student ${spec.idNumber}: already on roster (password unchanged).`,
        );
      } else {
        throw error;
      }
    }
  }
}

async function main() {
  await mongoose.connect(
    process.env.MONGODB_URI || "mongodb://localhost:27017/mod-u-go",
  );
  console.log("Connected. Seeding platform accounts…\n");

  // 1. Legacy-role cleanup (idempotent): remap every retired role name to
  // its current value using the same alias table the schema applies on save.
  for (const [legacy, current] of Object.entries(ROLE_ALIASES)) {
    const res = await User.updateMany(
      { role: legacy },
      { $set: { role: current } },
    );
    if (res.modifiedCount > 0) {
      notes.push(
        `remapped ${res.modifiedCount} legacy "${legacy}" account(s) to ${current}`,
      );
    }
  }

  await seedSuperAdmin();
  await seedStaff(ADMINS, "admin");
  await seedStaff(COORDINATORS, "coordinator");
  await seedStudents();

  console.log("Notes:");
  notes.forEach((n) => console.log(`  • ${n}`));

  console.log("\n══════════ CREDENTIALS (shown once) ══════════");
  credentials.forEach(([tier, email, pw]) =>
    console.log(`  ${tier.padEnd(20)} ${email.padEnd(26)} ${pw}`),
  );
  console.log("══════════════════════════════════════════════\n");
}

main()
  .catch((err) => {
    console.error("Seeding failed:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
