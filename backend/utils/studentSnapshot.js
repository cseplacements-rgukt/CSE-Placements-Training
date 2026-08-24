// Denormalized student identity snapshot.
//
// Deleting a roster student/batch intentionally KEEPS their Submission and
// ProctoringSession history (year-over-year reporting). Since the live User
// row is gone, populate("studentId") resolves to null — every consumer uses
// the snapshot fields stamped onto the documents at creation time (and via
// the one-time backfill script) to still show who took the exam.

const snapshotFieldsFromUser = (user) => ({
  studentName: user?.name || null,
  studentIdNumber: user?.idNumber || null,
  batchYear: user?.batchYear ?? null,
});

const SNAPSHOT_SELECT = "studentName studentIdNumber batchYear";

// Returns a display object for a submission/session's student, preferring
// the populated live User but falling back to the denormalized snapshot
// when the account has been deleted. Works on both lean objects and
// hydrated mongoose docs (reads plain properties only).
function resolveStudentDisplay(doc) {
  if (!doc) return doc;
  const populated =
    doc.studentId && typeof doc.studentId === "object" ? doc.studentId : null;

  if (populated && (populated.name || populated.email)) {
    return {
      ...doc,
      studentId: {
        _id: populated._id,
        name: populated.name || doc.studentName || "Unknown student",
        email: populated.email || null,
        idNumber: doc.studentIdNumber || null,
        batchYear: doc.batchYear ?? null,
      },
    };
  }

  const rawId = populated?._id ?? doc.studentId;
  const hasSnapshot = doc.studentName || doc.studentIdNumber;
  return {
    ...doc,
    studentId: hasSnapshot
      ? {
          _id: rawId,
          name: doc.studentName,
          email: null,
          idNumber: doc.studentIdNumber,
          batchYear: doc.batchYear ?? null,
          deletedStudent: true,
        }
      : { _id: rawId, name: "Unknown student", email: null, deletedStudent: true },
  };
}

function applyStudentSnapshotFallback(docs) {
  if (Array.isArray(docs)) return docs.map(resolveStudentDisplay);
  return resolveStudentDisplay(docs);
}

module.exports = {
  SNAPSHOT_SELECT,
  snapshotFieldsFromUser,
  resolveStudentDisplay,
  applyStudentSnapshotFallback,
};
