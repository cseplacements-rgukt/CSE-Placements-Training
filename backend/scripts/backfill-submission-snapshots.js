/*
 * One-time backfill: stamp the denormalized student identity snapshot
 * (studentName / studentIdNumber / batchYear) onto Submission and
 * ProctoringSession documents that predate the roster system, while their
 * User accounts still exist to copy from.
 *
 * Run manually after deploying the snapshot change and BEFORE deleting any
 * batches:
 *   node scripts/backfill-submission-snapshots.js
 *
 * Submissions whose studentId no longer resolves to a live user cannot be
 * recovered — they are counted and left as-is (they will render as
 * "Unknown student" in reports).
 */
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");
const Submission = require("../models/Submission");
const ProctoringSession = require("../models/ProctoringSession");
const { snapshotFieldsFromUser } = require("../utils/studentSnapshot");

async function backfill(Model, label) {
  const filter = {
    studentName: { $in: [null, ""] },
    studentId: { $exists: true },
  };

  const cursor = Model.find(filter).populate("studentId", "name idNumber batchYear").cursor();
  let stamped = 0;
  let orphaned = 0;

  for (let doc = await cursor.next(); doc; doc = await cursor.next()) {
    const u = doc.studentId;
    if (!u || typeof u !== "object" || !u.name) {
      orphaned += 1;
      continue;
    }
    await Model.updateOne(
      { _id: doc._id },
      { $set: snapshotFieldsFromUser(u) },
    );
    stamped += 1;
  }

  console.log(`${label}: stamped ${stamped}, orphaned (user gone): ${orphaned}`);
}

async function main() {
  await mongoose.connect(
    process.env.MONGODB_URI || "mongodb://localhost:27017/mod-u-go",
  );

  await backfill(Submission, "Submissions");
  await backfill(ProctoringSession, "ProctoringSessions");

  console.log("Backfill complete.");
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
