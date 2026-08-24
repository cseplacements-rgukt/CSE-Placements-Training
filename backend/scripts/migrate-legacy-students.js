/*
 * One-time migration for students who self-registered before the roster
 * system existed (real Firebase UIDs, no roster fields). Run manually by
 * whoever deploys — never on server start.
 *
 * REPORT MODE (default — safe, changes nothing):
 *   node scripts/migrate-legacy-students.js
 *   Lists every legacy student account and writes a CSV next to this script
 *   (`legacy-students-report-<timestamp>.csv`) for manual review. Most
 *   pre-roster students signed up with personal emails, so their ID numbers
 *   and batch years CANNOT be derived reliably — those need to be added by
 *   hand via the admin UI's Students tab using this report.
 *
 * AUTO MODE (opt-in, conservative):
 *   node scripts/migrate-legacy-students.js --auto --batch-year 2024
 *   Converts a legacy account into a roster account IN PLACE (same _id, so
 *   existing submissions stay linked) ONLY when ALL of these hold:
 *     • their email matches <id>@rguktsklm.ac.in (college domain), AND
 *     • the derived ID doesn't collide with an existing roster entry, AND
 *     • the admin supplied the batch year explicitly (never guessed from
 *       the ID text — transfers/repeats make that unreliable).
 *   Everything else is skipped and listed in the report instead.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const User = require("../models/User");

const COLLEGE_EMAIL_DOMAIN = "rguktsklm.ac.in";
const args = process.argv.slice(2);
const autoMode = args.includes("--auto");
const batchYearFlagIdx = args.indexOf("--batch-year");
const batchYear =
  batchYearFlagIdx !== -1 ? parseInt(args[batchYearFlagIdx + 1]) : null;

async function main() {
  if (autoMode && (!batchYear || batchYear < 2000 || batchYear > 2100)) {
    console.error(
      "Auto mode requires a valid batch year: --auto --batch-year 2024",
    );
    process.exitCode = 1;
    return;
  }

  await mongoose.connect(
    process.env.MONGODB_URI || "mongodb://localhost:27017/mod-u-go",
  );

  const legacyStudents = await User.find({
    role: "student",
    firebaseUid: { $not: /^roster:/ },
  })
    .select("email name firebaseUid createdAt lastLogin")
    .sort({ createdAt: 1 })
    .lean();

  console.log(
    `\nFound ${legacyStudents.length} pre-roster student account(s).\n`,
  );
  if (legacyStudents.length === 0) {
    console.log("Nothing to migrate.");
    return;
  }

  const rows = [];
  let converted = 0;
  let skippedNoCollegeEmail = 0;
  let skippedCollision = 0;

  for (const s of legacyStudents) {
    const email = String(s.email || "").toLowerCase();
    const match = email.match(new RegExp(`^([a-z0-9._-]+)@${COLLEGE_EMAIL_DOMAIN}$`));
    const derivableId = match ? match[1] : null;

    let status = "needs-manual-entry";
    let note = derivableId
      ? ""
      : "email is not a college address; ID/batch not derivable";

    if (autoMode && derivableId) {
      const collision = await User.findOne({
        $or: [
          { idNumberNormalized: derivableId },
          { firebaseUid: `roster:${derivableId}` },
        ],
      }).select("_id");

      // Also treat a DIFFERENT account already holding this email as a
      // conflict (can't happen here since we'd be updating the same doc,
      // but keeps the guard explicit).
      if (collision && String(collision._id) !== String(s._id)) {
        status = "skipped-id-collision";
        note = `ID ${derivableId} already exists on another roster entry`;
        skippedCollision += 1;
      } else {
        await User.updateOne(
          { _id: s._id },
          {
            $set: {
              firebaseUid: `roster:${derivableId}`,
              idNumber: derivableId,
              idNumberNormalized: derivableId,
              batchYear,
            },
          },
        );
        status = "converted";
        converted += 1;
      }
    } else if (!derivableId) {
      skippedNoCollegeEmail += 1;
    }

    rows.push({
      email,
      name: s.name || "",
      firebaseUid: s.firebaseUid || "",
      createdAt: s.createdAt ? new Date(s.createdAt).toISOString() : "",
      lastLogin: s.lastLogin ? new Date(s.lastLogin).toISOString() : "never",
      derivableId: derivableId || "",
      suggestedEmail: derivableId
        ? `${derivableId}@${COLLEGE_EMAIL_DOMAIN}`
        : "",
      status,
      note,
    });
  }

  // Console summary table
  console.table(
    rows.map((r) => ({
      name: r.name,
      email: r.email,
      status: r.status,
      derivableId: r.derivableId || "-",
    })),
  );

  // CSV report for the Students tab workflow
  const header =
    "name,email,firebaseUid,createdAt,lastLogin,suggestedIdNumber,suggestedRosterEmail,status,note";
  const csv = [
    header,
    ...rows.map((r) =>
      [r.name, r.email, r.firebaseUid, r.createdAt, r.lastLogin, r.derivableId, r.suggestedEmail, r.status, `"${r.note}"`]
        .map((v) => String(v).replace(/"/g, '""'))
        .join(","),
    ),
  ].join("\n");
  const outPath = path.join(
    __dirname,
    `legacy-students-report-${Date.now()}.csv`,
  );
  fs.writeFileSync(outPath, csv);

  console.log(
    `\nReport written to ${outPath}\n` +
      `Converted: ${converted}` +
      (autoMode
        ? ` | Skipped (no college email): ${skippedNoCollegeEmail} | Skipped (ID collision): ${skippedCollision}`
        : "") +
      `\nAdd remaining students via Admin Panel → Students tab (their historical submissions stay linked only if you use the SAME id number as their old college email where shown).`,
  );

  if (!autoMode) {
    console.log(
      "\nThis was report-only mode. To convert accounts with derivable college emails in place, rerun with:\n" +
        "  --auto --batch-year <year>\n",
    );
  }
}

main()
  .catch((err) => {
    console.error("Migration failed:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
