const express = require("express");
const router = express.Router();
const Exam = require("../models/Exam");
const { generateExamCode, EDITABLE_STATUSES } = require("../models/Exam");
const Question = require("../models/Question");
const User = require("../models/User");
const Submission = require("../models/Submission");
const verifyFirebaseToken = require("../middleware/auth");
const { examCodeLimiter } = require("../middleware/rateLimiter");
const mongoose = require("mongoose");

// ─── Helper: human-readable date/time for student-facing messages ───────────
function formatExamDateTime(date) {
  return new Date(date).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

// ─── Helper: collaborative access resolution ────────────────────────────────
// Replaces single-owner checks. A staff member (coordinator / admin) may manage
// an exam when they are the platform-level admin role, the exam's creator
// (teacherId), or an explicit collaborator. Everyone else gets 403.
async function resolveExamAccess(req, res) {
  const user = await User.findOne({ firebaseUid: req.user.uid });
  if (!user || !["coordinator", "admin", "super_admin"].includes(user.role)) {
    res.status(403).json({ message: "Only training-team staff (coordinator tier) can perform this action" });
    return null;
  }

  const exam = await Exam.findById(req.params.examId || req.params.id);
  if (!exam) {
    res.status(404).json({ message: "Exam not found" });
    return null;
  }

  const isAdminRole = ["admin", "super_admin"].includes(user.role);
  const isCreator = exam.teacherId && exam.teacherId.toString() === user._id.toString();
  const isCollaborator = (exam.collaborators || []).some(
    (c) => c.userId && c.userId.toString() === user._id.toString()
  );

  if (!isAdminRole && !isCreator && !isCollaborator) {
    res.status(403).json({ message: "You do not have access to this exam." });
    return null;
  }

  return { user, exam, isCreator, isAdminRole };
}

// ─── Helper: is the exam still being built by the team? ─────────────────────
const isEditableStatus = (exam) => EDITABLE_STATUSES.includes(exam.status);

// ═══════════════════════════════════════════════════════════════════════════════
// EXAM CRUD
// ═══════════════════════════════════════════════════════════════════════════════

// Create a new exam (Coordinator tier or above).
// Shell creation: only a title (+ optional category/description) is required.
// Timing is NOT required here — it is enforced at publish time.
router.post("/", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || !["coordinator", "admin", "super_admin"].includes(user.role)) {
      return res.status(403).json({ message: "Only training-team staff (coordinator tier) can create exams" });
    }

    const { title, description, targetCompany, examCategory, instructions, questions, scheduledAt, duration, settings } = req.body;

    if (!title || typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ message: "Title is required." });
    }

    let scheduledDate = null;
    let endTime = null;
    if (scheduledAt) {
      scheduledDate = new Date(scheduledAt);
      endTime = new Date(scheduledDate.getTime() + (duration || 60) * 60000);
    }

    const exam = new Exam({
      title: title.trim(),
      description,
      targetCompany: targetCompany || "General",
      examCategory,
      instructions,
      teacherId: user._id,
      collaborators: [{ userId: user._id, role: "creator", addedAt: new Date() }],
      sections: [],
      questions: questions || [],
      scheduledAt: scheduledDate,
      duration: duration || null,
      endTime,
      settings: settings || {},
      status: "draft",
      isActive: false,
    });

    await exam.save();
    res.status(201).json({ exam, message: "Exam created successfully" });
  } catch (error) {
    console.error("Error creating exam:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get all exams
router.get("/", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    let exams;
    if (user.role === "coordinator") {
      // Exams this admin created OR drafts they collaborate on.
      exams = await Exam.find({
        $or: [{ teacherId: user._id }, { "collaborators.userId": user._id }],
      }).sort({ createdAt: -1 });
    } else if (["admin", "super_admin"].includes(user.role)) {
      exams = await Exam.find({}).sort({ createdAt: -1 });
    } else {
      // Students discover exams exclusively via exam codes.
      // No browsing — return empty list.
      exams = [];
    }

    res.json({ exams });
  } catch (error) {
    console.error("Error getting exams:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// List the training team's shared drafts (draft + ready_for_review) that this
// admin created or collaborates on. Declared before /:id.
router.get("/drafts", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || !["coordinator", "admin", "super_admin"].includes(user.role)) {
      return res.status(403).json({ message: "Only training-team staff (coordinator tier) can view drafts" });
    }

    const filter =
      ["admin", "super_admin"].includes(user.role)
        ? { status: { $in: EDITABLE_STATUSES } }
        : {
            status: { $in: EDITABLE_STATUSES },
            $or: [{ teacherId: user._id }, { "collaborators.userId": user._id }],
          };

    const raw = await Exam.find(filter)
      .populate("collaborators.userId", "name email")
      .sort({ updatedAt: -1 })
      .lean();

    // Flatten populated user objects so clients get {name,email} per entry
    const exams = raw.map((exam) => ({
      ...exam,
      collaborators: (exam.collaborators || []).map((c) => ({
        _id: c._id,
        userId: c.userId?._id || c.userId,
        role: c.role,
        addedAt: c.addedAt,
        name: c.userId?.name || "",
        email: c.userId?.email || "",
      })),
    }));

    res.json({ exams });
  } catch (error) {
    console.error("Error listing team drafts:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get a single exam by ID
router.get("/:id", verifyFirebaseToken, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid exam ID" });
    }

    const exam = await Exam.findById(req.params.id);
    if (!exam) {
      return res.status(404).json({ message: "Exam not found" });
    }

    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Students: enforce exam-code access — they can only see questions if they have an active attempt.
    if (user.role === "student") {
      if (exam.status === "draft" || exam.status === "ready_for_review") {
        return res.status(403).json({ message: "Exam is not available yet" });
      }

      // Verify the student has a legitimate submission for this exam
      const hasSubmission = await Submission.exists({
        examId: exam._id,
        studentId: user._id,
      });

      const examData = exam.toObject();
      if (!hasSubmission) {
        // Safe metadata only. No questions array.
        examData.questionCount = examData.questions.length;
        delete examData.questions;
      } else {
        // Has submission. Return questions but strip answers.
        examData.questions = examData.questions.map((q) => {
          const { correctAnswer, modelAnswer, ...questionWithoutAnswer } = q;
          return questionWithoutAnswer;
        });
      }
      return res.json({ exam: examData });
    }

    // Teachers and admins can see full exam with answers
    res.json({ exam });
  } catch (error) {
    console.error("Error getting exam:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update an exam (metadata only — questions are managed through the atomic
// per-question endpoints so parallel editors never overwrite each other).
router.put("/:id", verifyFirebaseToken, async (req, res) => {
  try {
    const result = await resolveExamAccess(req, res);
    if (!result) return;
    const { user, exam, isCreator, isAdminRole } = result;

    // Once live, only the creator (or platform admin) may touch metadata.
    if (!isEditableStatus(exam) && !isCreator && !isAdminRole) {
      return res.status(403).json({ message: "Only the exam creator can update a published exam" });
    }

    const {
      title, description, targetCompany, examCategory, instructions,
      scheduledAt, duration, isActive, settings,
    } = req.body;

    if (title) exam.title = title;
    if (description !== undefined) exam.description = description;
    if (targetCompany !== undefined) exam.targetCompany = targetCompany;
    if (examCategory) exam.examCategory = examCategory;
    if (instructions !== undefined) exam.instructions = instructions;
    if (scheduledAt) {
      exam.scheduledAt = new Date(scheduledAt);
      if (duration) {
        exam.endTime = new Date(exam.scheduledAt.getTime() + duration * 60000);
      } else if (exam.duration) {
        exam.endTime = new Date(exam.scheduledAt.getTime() + exam.duration * 60000);
      }
    }
    if (duration) {
      exam.duration = duration;
      const base = exam.scheduledAt ? new Date(exam.scheduledAt) : new Date();
      exam.endTime = new Date(base.getTime() + duration * 60000);
    }
    if (isActive !== undefined) exam.isActive = isActive;
    if (settings) exam.settings = { ...exam.settings, ...settings };

    await exam.save();
    res.json({ exam, message: "Exam updated successfully" });
  } catch (error) {
    console.error("Error updating exam:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Delete an exam (Creator or platform Admin only)
router.delete("/:id", verifyFirebaseToken, async (req, res) => {
  try {
    const result = await resolveExamAccess(req, res);
    if (!result) return;
    const { exam, isCreator, isAdminRole } = result;

    if (!isCreator && !isAdminRole) {
      return res.status(403).json({ message: "Only the exam creator can delete this exam" });
    }

    // Prevent deletion if submissions exist
    const submissionCount = await Submission.countDocuments({ examId: exam._id });
    if (submissionCount > 0) {
      return res.status(400).json({ message: "Cannot delete an exam that has submissions. Please close or archive it instead." });
    }

    await Exam.findByIdAndDelete(req.params.id);
    res.json({ message: "Exam deleted successfully" });
  } catch (error) {
    console.error("Error deleting exam:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// COLLABORATORS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/exams/:id/collaborators — list the team with names
router.get("/:id/collaborators", verifyFirebaseToken, async (req, res) => {
  try {
    const result = await resolveExamAccess(req, res);
    if (!result) return;

    const exam = await Exam.findById(result.exam._id)
      .populate("collaborators.userId", "name email")
      .populate("teacherId", "name email");

    res.json({
      collaborators: exam.collaborators.map((c) => ({
        _id: c._id,
        userId: c.userId?._id || c.userId,
        name: c.userId?.name || "Unknown",
        email: c.userId?.email || "",
        role: c.role,
        addedAt: c.addedAt,
      })),
    });
  } catch (error) {
    console.error("Error listing collaborators:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// POST /api/exams/:id/collaborators — creator/admin adds a team member by email
router.post("/:id/collaborators", verifyFirebaseToken, async (req, res) => {
  try {
    const result = await resolveExamAccess(req, res);
    if (!result) return;
    const { exam, isCreator, isAdminRole } = result;

    if (!isEditableStatus(exam)) {
      return res.status(400).json({ message: "Collaborators can only be added while the exam is a draft." });
    }
    if (!isCreator && !isAdminRole) {
      return res.status(403).json({ message: "Only the exam creator can add collaborators." });
    }

    const { email } = req.body;
    if (!email || typeof email !== "string") {
      return res.status(400).json({ message: "Collaborator email is required." });
    }

    const invitee = await User.findOne({ email: email.trim().toLowerCase() });
    if (!invitee) {
      return res.status(404).json({ message: "No MOD-U-GO account found with that email." });
    }
    if (!["coordinator", "admin", "super_admin"].includes(invitee.role)) {
      return res.status(400).json({ message: "Only training-team staff (coordinator tier) can be added as collaborators." });
    }

    const alreadyIn = (exam.collaborators || []).some(
      (c) => c.userId && c.userId.toString() === invitee._id.toString()
    );
    if (alreadyIn) {
      return res.status(400).json({ message: `${invitee.name} is already on this exam.` });
    }

    exam.collaborators.push({
      userId: invitee._id,
      role: "contributor",
      addedAt: new Date(),
    });
    await exam.save();

    res.json({ exam, message: `${invitee.name} added to the team.` });
  } catch (error) {
    console.error("Error adding collaborator:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// DELETE /api/exams/:id/collaborators/:userId — creator/admin removes a contributor
router.delete("/:id/collaborators/:userId", verifyFirebaseToken, async (req, res) => {
  try {
    const result = await resolveExamAccess(req, res);
    if (!result) return;
    const { exam, isCreator, isAdminRole } = result;

    if (!isCreator && !isAdminRole) {
      return res.status(403).json({ message: "Only the exam creator can remove collaborators." });
    }

    const entry = (exam.collaborators || []).find(
      (c) => c.userId && c.userId.toString() === req.params.userId
    );
    if (!entry) {
      return res.status(404).json({ message: "That user is not a collaborator on this exam." });
    }
    if (entry.role === "creator") {
      return res.status(400).json({ message: "The creator cannot be removed from their own exam." });
    }

    exam.collaborators = exam.collaborators.filter(
      (c) => !(c.userId && c.userId.toString() === req.params.userId)
    );
    await exam.save();

    res.json({ exam, message: "Collaborator removed." });
  } catch (error) {
    console.error("Error removing collaborator:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTIONS (optional lightweight organization — difficulty buckets are just
// sections named Easy/Medium/Hard, not a separate system)
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/exams/:id/sections — create a named section
router.post("/:id/sections", verifyFirebaseToken, async (req, res) => {
  try {
    const result = await resolveExamAccess(req, res);
    if (!result) return;
    const { exam, user } = result;

    if (!isEditableStatus(exam)) {
      return res.status(400).json({ message: "Sections can only be changed while the exam is a draft." });
    }

    const { name } = req.body;
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ message: "Section name is required." });
    }

    const duplicate = (exam.sections || []).some(
      (s) => s.name.toLowerCase() === name.trim().toLowerCase()
    );
    if (duplicate) {
      return res.status(400).json({ message: "A section with that name already exists." });
    }

    exam.sections.push({ name: name.trim(), ownerIds: [user._id], createdAt: new Date() });
    await exam.save();

    res.status(201).json({ exam, section: exam.sections[exam.sections.length - 1], message: "Section created" });
  } catch (error) {
    console.error("Error creating section:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// PUT /api/exams/:id/sections/:sectionId — rename / reassign owners
router.put("/:id/sections/:sectionId", verifyFirebaseToken, async (req, res) => {
  try {
    const result = await resolveExamAccess(req, res);
    if (!result) return;
    const { exam, isCreator, isAdminRole } = result;

    if (!isEditableStatus(exam)) {
      return res.status(400).json({ message: "Sections can only be changed while the exam is a draft." });
    }

    const section = exam.sections.id(req.params.sectionId);
    if (!section) {
      return res.status(404).json({ message: "Section not found" });
    }

    const { name, ownerIds } = req.body;
    if (name !== undefined) {
      if (!String(name).trim()) {
        return res.status(400).json({ message: "Section name cannot be empty." });
      }
      const duplicate = (exam.sections || []).some(
        (s) => s._id.toString() !== req.params.sectionId &&
          s.name.toLowerCase() === String(name).trim().toLowerCase()
      );
      if (duplicate) {
        return res.status(400).json({ message: "A section with that name already exists." });
      }
      section.name = String(name).trim();
    }

    if (ownerIds !== undefined) {
      if (!isCreator && !isAdminRole) {
        return res.status(403).json({ message: "Only the exam creator can reassign section owners." });
      }
      if (!Array.isArray(ownerIds)) {
        return res.status(400).json({ message: "ownerIds must be an array of user IDs." });
      }
      section.ownerIds = ownerIds;
    }

    await exam.save();
    res.json({ exam, message: "Section updated" });
  } catch (error) {
    console.error("Error updating section:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// DELETE /api/exams/:id/sections/:sectionId — remove a section; its questions
// fall back into the ungrouped pool (atomic, via arrayFilters).
router.delete("/:id/sections/:sectionId", verifyFirebaseToken, async (req, res) => {
  try {
    const result = await resolveExamAccess(req, res);
    if (!result) return;
    const { exam, isCreator, isAdminRole } = result;

    if (!isCreator && !isAdminRole) {
      return res.status(403).json({ message: "Only the exam creator can delete a section." });
    }

    const section = exam.sections.id(req.params.sectionId);
    if (!section) {
      return res.status(404).json({ message: "Section not found" });
    }

    // Atomic: remove the section and detach its questions in one write.
    const updated = await Exam.findByIdAndUpdate(
      exam._id,
      {
        $pull: { sections: { _id: section._id } },
        $set: { "questions.$[q].sectionId": null, updatedAt: new Date() },
      },
      { arrayFilters: [{ "q.sectionId": section._id }], new: true }
    );

    res.json({ exam: updated, message: "Section deleted. Its questions moved to the ungrouped pool." });
  } catch (error) {
    console.error("Error deleting section:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXAM LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════════════

// Pre-publish status transitions: draft ↔ ready_for_review. The compiled exam
// stays fully editable until it is actually published.
router.put("/:id/status", verifyFirebaseToken, async (req, res) => {
  try {
    const result = await resolveExamAccess(req, res);
    if (!result) return;
    const { exam, user, isCreator, isAdminRole } = result;

    if (!EDITABLE_STATUSES.includes(exam.status)) {
      return res.status(400).json({ message: "Status can only change between Draft and Ready for Review before publishing." });
    }

    const { status } = req.body;
    if (!["draft", "ready_for_review"].includes(status)) {
      return res.status(400).json({ message: "Invalid status. Use 'draft' or 'ready_for_review'." });
    }

    if (status === "ready_for_review" && !isCreator && !isAdminRole) {
      return res.status(403).json({ message: "Only the exam creator can submit the exam for review." });
    }

    exam.status = status;
    if (status === "ready_for_review") {
      exam.submittedForReviewAt = new Date();
      exam.submittedBy = user._id;
    } else {
      exam.submittedForReviewAt = null;
      exam.submittedBy = null;
    }
    await exam.save();

    res.json({ exam, message: status === "ready_for_review" ? "Exam submitted for review." : "Exam reopened for editing." });
  } catch (error) {
    console.error("Error updating exam status:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Publish an exam — TIMING IS REQUIRED HERE (scheduledAt/duration accepted in
// body and persisted; falls back to values already stored on the exam).
// Only the creator or a platform admin can publish.
router.put("/:id/publish", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || !["coordinator", "admin", "super_admin"].includes(user.role)) {
      return res.status(403).json({ message: "Only training-team staff (coordinator tier) can publish exams" });
    }

    const exam = await Exam.findById(req.params.id);
    if (!exam) return res.status(404).json({ message: "Exam not found" });

    const isAdminRole = ["admin", "super_admin"].includes(user.role);
    const isCreator = exam.teacherId && exam.teacherId.toString() === user._id.toString();
    if (!isAdminRole && !isCreator) {
      return res.status(403).json({ message: "Only the exam creator can publish this exam" });
    }

    // Apply timing provided at publish time
    const { scheduledAt, duration } = req.body || {};
    if (scheduledAt) exam.scheduledAt = new Date(scheduledAt);
    if (duration) exam.duration = Number(duration);

    // Publish Validation
    const validationErrors = [];
    if (!exam.title || exam.title.trim() === "") validationErrors.push("Title is required.");
    if (!exam.duration || exam.duration <= 0) validationErrors.push("Duration (minutes) is required.");
    if (!exam.scheduledAt) validationErrors.push("Exam date & time is required.");

    // Derive endTime from the (possibly just-updated) schedule
    if (exam.scheduledAt && exam.duration) {
      exam.endTime = new Date(new Date(exam.scheduledAt).getTime() + exam.duration * 60000);
    }

    // Prevent publishing an exam whose window has already passed — students
    // would see "no longer available" the moment they enter the code.
    if (validationErrors.length === 0 && exam.endTime <= new Date()) {
      validationErrors.push(
        `The scheduled window already ended on ${formatExamDateTime(exam.endTime)}. Update the schedule before publishing.`
      );
    }
    if (!exam.questions || exam.questions.length === 0) validationErrors.push("Exam must have at least one question.");

    if (validationErrors.length > 0) {
      return res.status(400).json({ message: "Cannot publish exam.", errors: validationErrors });
    }

    // Generate exam code if not already set
    if (!exam.examCode) {
      let code;
      let attempts = 0;
      do {
        code = generateExamCode();
        const existing = await Exam.findOne({ examCode: code });
        if (!existing) break;
        attempts++;
      } while (attempts < 10);

      if (attempts >= 10) {
        return res.status(500).json({ message: "Failed to generate unique exam code. Please try again." });
      }
      exam.examCode = code;
    }

    exam.status = "published";
    exam.isActive = true;
    await exam.save();

    res.json({ exam, message: "Exam published successfully" });
  } catch (error) {
    console.error("Error publishing exam:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Unpublish an exam — move back to draft so questions become editable again.
// Only allowed while no student has attempted it. The examCode is retained so
// re-publishing keeps the same code.
router.put("/:id/unpublish", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || !["coordinator", "admin", "super_admin"].includes(user.role)) {
      return res.status(403).json({ message: "Only training-team staff (coordinator tier) can unpublish exams" });
    }

    const exam = await Exam.findById(req.params.id);
    if (!exam) return res.status(404).json({ message: "Exam not found" });

    if (user.role === "coordinator" && exam.teacherId.toString() !== user._id.toString()) {
      return res.status(403).json({ message: "You can only manage your own exams" });
    }

    if (exam.status !== "published") {
      return res.status(400).json({ message: "Only published exams can be unpublished." });
    }

    const submissionCount = await Submission.countDocuments({ examId: exam._id });
    if (submissionCount > 0) {
      return res.status(400).json({
        message: "Students have already started or submitted this exam. It cannot be unpublished.",
      });
    }

    exam.status = "draft";
    exam.isActive = false;
    await exam.save();

    res.json({ exam, message: "Exam moved back to draft. The exam code stays the same when you publish again." });
  } catch (error) {
    console.error("Error unpublishing exam:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Close an exam
router.put("/:id/close", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || !["coordinator", "admin", "super_admin"].includes(user.role)) {
      return res.status(403).json({ message: "Only training-team staff (coordinator tier) can close exams" });
    }

    const exam = await Exam.findById(req.params.id);
    if (!exam) return res.status(404).json({ message: "Exam not found" });

    if (user.role === "coordinator" && exam.teacherId.toString() !== user._id.toString()) {
      return res.status(403).json({ message: "You can only close your own exams" });
    }

    exam.status = "closed";
    exam.endTime = new Date();
    await exam.save();

    res.json({ exam, message: "Exam closed successfully" });
  } catch (error) {
    console.error("Error closing exam:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONSOLIDATED REVIEW VIEW
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/exams/:id/review — every question grouped by section and author so
// the creator can review the whole compiled exam in one place.
router.get("/:id/review", verifyFirebaseToken, async (req, res) => {
  try {
    const result = await resolveExamAccess(req, res);
    if (!result) return;
    const { exam } = result;

    const authorIds = [...new Set(
      (exam.questions || [])
        .map((q) => q.createdBy)
        .filter(Boolean)
        .map((id) => id.toString())
    )];
    const authors = await User.find({ _id: { $in: authorIds } }).select("name email");

    const authorMap = {};
    authors.forEach((a) => {
      authorMap[a._id.toString()] = { _id: a._id, name: a.name, email: a.email };
    });
    // Fall back to denormalized snapshot names where the user record is gone
    (exam.questions || []).forEach((q) => {
      if (q.createdBy && !authorMap[q.createdBy.toString()] && q.createdByName) {
        authorMap[q.createdBy.toString()] = { _id: q.createdBy, name: q.createdByName, email: "" };
      }
    });

    const groupOf = (sectionId) =>
      (exam.questions || []).filter((q) =>
        sectionId ? q.sectionId && q.sectionId.toString() === sectionId : !q.sectionId
      );

    const sections = (exam.sections || []).map((s) => ({
      _id: s._id,
      name: s.name,
      owners: (s.ownerIds || [])
        .map((id) => authorMap[id.toString()])
        .filter(Boolean),
      questions: groupOf(s._id.toString()),
    }));

    const ungrouped = groupOf(null);

    const totalPoints = (exam.questions || []).reduce((sum, q) => sum + (q.points || 1), 0);
    const byAuthor = Object.values(authorMap)
      .map((a) => {
        const qs = (exam.questions || []).filter(
          (q) => q.createdBy && q.createdBy.toString() === a._id.toString()
        );
        return {
          ...a,
          count: qs.length,
          points: qs.reduce((sum, q) => sum + (q.points || 1), 0),
        };
      })
      .filter((a) => a.count > 0);

    res.json({
      exam: {
        _id: exam._id,
        title: exam.title,
        status: exam.status,
        examCategory: exam.examCategory,
        scheduledAt: exam.scheduledAt,
        duration: exam.duration,
        examCode: exam.examCode,
        submittedForReviewAt: exam.submittedForReviewAt,
      },
      sections,
      ungrouped,
      stats: {
        totalQuestions: (exam.questions || []).length,
        totalPoints,
        sectionCount: (exam.sections || []).length,
        authors: byAuthor,
      },
    });
  } catch (error) {
    console.error("Error building review view:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXAM CODE — JOIN ENDPOINT
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/exams/join — Student enters exam code to get exam info
router.post("/join", verifyFirebaseToken, examCodeLimiter, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || user.role !== "student") {
      return res.status(403).json({ message: "Only students can join exams" });
    }

    const { examCode } = req.body;
    if (!examCode || typeof examCode !== "string") {
      return res.status(400).json({ message: "Exam code is required." });
    }

    // Normalize: uppercase, trim
    const normalizedCode = examCode.trim().toUpperCase();
    if (normalizedCode.length < 4 || normalizedCode.length > 10) {
      return res.status(400).json({ message: "Invalid exam code format." });
    }

    const exam = await Exam.findOne({ examCode: normalizedCode });
    if (!exam) {
      return res.status(404).json({ message: "Exam code not found." });
    }

    if (exam.status === "draft" || exam.status === "ready_for_review") {
      return res.status(400).json({ message: "This exam is not currently available." });
    }
    if (exam.status === "closed" || exam.status === "archived") {
      return res.status(400).json({ message: "This exam is no longer available." });
    }

    // Check exam time window with distinct, actionable messages
    const now = new Date();
    if (now < exam.scheduledAt) {
      // Joining early is allowed so students can preview details,
      // but the response flags it as upcoming.
    }
    if (now > exam.endTime) {
      return res.status(400).json({
        code: "EXAM_ENDED",
        message: `This exam is no longer available. It ended on ${formatExamDateTime(exam.endTime)}.`,
      });
    }

    const windowState = now >= exam.scheduledAt ? "live" : "upcoming";

    // Check if student already submitted
    const existingSubmission = await Submission.findOne({
      examId: exam._id,
      studentId: user._id,
    });

    if (existingSubmission && existingSubmission.status !== "in_progress") {
      return res.status(400).json({ message: "You have already submitted this exam." });
    }

    // Return safe exam info (no answers)
    const examInfo = {
      _id: exam._id,
      title: exam.title,
      description: exam.description,
      targetCompany: exam.targetCompany,
      examCategory: exam.examCategory,
      duration: exam.duration,
      scheduledAt: exam.scheduledAt,
      endTime: exam.endTime,
      questionCount: exam.questions.length,
      settings: {
        requireWebcam: exam.settings?.requireWebcam,
        requireFullscreen: exam.settings?.requireFullscreen,
        allowBackNavigation: exam.settings?.allowBackNavigation,
        showResultsImmediately: exam.settings?.showResultsImmediately,
        autoSubmitOnTimeUp: exam.settings?.autoSubmitOnTimeUp,
        passingScore: exam.settings?.passingScore,
        minDurationMinutes: exam.settings?.minDurationMinutes ?? 0,
      },
      hasActiveAttempt: existingSubmission?.status === "in_progress",
      windowState,
    };

    res.json({ exam: examInfo, message: "Exam found" });
  } catch (error) {
    console.error("Error joining exam:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ATOMIC QUESTION OPERATIONS (Collaborative Exam Builder)
// Append-only $push/$pull/$set on single subdocuments — safe for ~10 parallel
// editors. Never accept a whole replacement questions[] array here.
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/exams/:examId/questions — Atomically add a question to exam
router.post("/:examId/questions", verifyFirebaseToken, async (req, res) => {
  try {
    const result = await resolveExamAccess(req, res);
    if (!result) return;
    const { user, exam } = result;

    // Team builds in draft AND ready_for_review; locked once published/closed.
    if (!isEditableStatus(exam)) {
      return res.status(400).json({ message: "Cannot add questions to a published or closed exam." });
    }

    const {
      type, question, options, correctAnswer, modelAnswer,
      points, explanation, constraints, imageUrl,
      contentType, codeSnippet, sectionId, questionBankId,
      category, topic, targetCompany, tags,
    } = req.body;

    // Validate required fields
    if (!question || !type || !correctAnswer) {
      return res.status(400).json({ message: "Question text, type, and correct answer are required." });
    }

    if (type === "mcq") {
      if (!Array.isArray(options) || options.filter(o => o.trim()).length < 2) {
        return res.status(400).json({ message: "MCQ requires at least 2 options." });
      }
      if (!options.includes(correctAnswer)) {
        return res.status(400).json({ message: "Correct answer must match one of the options." });
      }
    }

    if (contentType === "code" && (!codeSnippet || !codeSnippet.code || !codeSnippet.code.trim())) {
      return res.status(400).json({ message: "A code snippet is required for code questions." });
    }

    // Validate the section (if any) belongs to this exam
    let resolvedSectionId = null;
    if (sectionId) {
      const section = exam.sections.id(sectionId);
      if (!section) {
        return res.status(400).json({ message: "Section not found on this exam." });
      }
      resolvedSectionId = section._id;
    }

    // Check for duplicate questionBankId in this exam
    if (questionBankId) {
      const hasDuplicate = exam.questions.some(
        (q) => q.questionBankId && q.questionBankId.toString() === questionBankId.toString()
      );
      if (hasDuplicate) {
        return res.status(400).json({ message: "This question is already in the exam." });
      }
    }

    // If no questionBankId, create a Question Bank record first
    const replaceExisting = req.body.replaceExisting === true;
    let wasReplaced = false;
    let resolvedQBId = questionBankId || null;
    if (!resolvedQBId) {
      // Duplicate detection: same question text (case/whitespace-insensitive)
      // for the same target company already exists in the bank → flag it and
      // let the author choose to replace it or keep the existing one.
      const escaped = String(question).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const duplicateQb = await Question.findOne({
        question: { $regex: `^\\s*${escaped}\\s*$`, $options: "i" },
        targetCompany: targetCompany || "General",
      });

      if (duplicateQb) {
        const inThisExam = exam.questions.some(
          (q) => q.questionBankId && q.questionBankId.toString() === duplicateQb._id.toString()
        );

        if (!replaceExisting) {
          return res.status(409).json({
            message: inThisExam
              ? "A question with this exact text already exists in this exam."
              : "A question with this exact text already exists in the question bank.",
            conflict: {
              questionBankId: duplicateQb._id,
              question: duplicateQb.question,
              targetCompany: duplicateQb.targetCompany,
              createdAt: duplicateQb.createdAt,
              inExam: inThisExam,
            },
          });
        }

        // Replace: overwrite the existing bank record with the new content
        await Question.findByIdAndUpdate(duplicateQb._id, {
          type,
          question,
          contentType: contentType === "code" ? "code" : "text",
          codeSnippet: {
            code: codeSnippet?.code || "",
            language: codeSnippet?.language || "plaintext",
          },
          options: type === "mcq" ? options.filter(o => o.trim()) : [],
          correctAnswer,
          modelAnswer: modelAnswer || "",
          points: points || 1,
          explanation: explanation || "",
          constraints: constraints || { wordLimit: null, difficultyLevel: "medium" },
          imageUrl: imageUrl || "",
          category: category || "Aptitude",
          topic: topic || "",
          targetCompany: targetCompany || "General",
          tags: tags || [],
        });

        // If the replaced question is embedded in this exam, refresh that snapshot too
        if (inThisExam) {
          await Exam.updateOne(
            { _id: exam._id, "questions.questionBankId": duplicateQb._id },
            {
              $set: {
                "questions.$.type": type,
                "questions.$.question": question,
                "questions.$.contentType": contentType === "code" ? "code" : "text",
                "questions.$.codeSnippet": {
                  code: codeSnippet?.code || "",
                  language: codeSnippet?.language || "plaintext",
                },
                "questions.$.options":
                  type === "mcq" || type === "true_false" ? (options || []).filter(o => o.trim()) : [],
                "questions.$.correctAnswer": correctAnswer,
                "questions.$.modelAnswer": modelAnswer || "",
                "questions.$.points": points || 1,
                "questions.$.explanation": explanation || "",
                "questions.$.imageUrl": imageUrl || "",
                "questions.$.constraints": constraints || { wordLimit: null, difficultyLevel: "medium" },
                updatedAt: new Date(),
              },
            }
          );
          const updated = await Exam.findById(exam._id);
          return res.status(200).json({
            exam: updated,
            replaced: true,
            addedQuestion: updated.questions.find(
              (q) => q.questionBankId && q.questionBankId.toString() === duplicateQb._id.toString()
            ),
            message: "Existing question replaced successfully.",
          });
        }

        // Not yet in this exam: attach a fresh snapshot pointing at the
        // (now-updated) existing bank record instead of creating another one.
        resolvedQBId = duplicateQb._id;
        wasReplaced = true;
      }
    }

    if (!resolvedQBId) {
      const qbRecord = new Question({
        type,
        question,
        contentType: contentType === "code" ? "code" : "text",
        codeSnippet: {
          code: codeSnippet?.code || "",
          language: codeSnippet?.language || "plaintext",
        },
        options: type === "mcq" ? options.filter(o => o.trim()) : [],
        correctAnswer,
        modelAnswer: modelAnswer || "",
        points: points || 1,
        explanation: explanation || "",
        constraints: constraints || { wordLimit: null, difficultyLevel: "medium" },
        imageUrl: imageUrl || "",
        category: category || "Aptitude",
        topic: topic || "",
        targetCompany: targetCompany || "General",
        tags: tags || [],
        createdBy: user._id,
      });
      await qbRecord.save();
      resolvedQBId = qbRecord._id;
    }

    // Use Date.now() for order to guarantee uniqueness under concurrent writes.
    // Two adds in the exact same millisecond are exceedingly rare and would still
    // be deterministic via _id sort.
    const orderValue = Date.now();

    // Atomically push question snapshot to exam
    const questionSnapshot = {
      type,
      question,
      contentType: contentType === "code" ? "code" : "text",
      codeSnippet: {
        code: codeSnippet?.code || "",
        language: codeSnippet?.language || "plaintext",
      },
      options: type === "mcq" || type === "true_false" ? (options || []).filter(o => o.trim()) : [],
      correctAnswer,
      modelAnswer: modelAnswer || "",
      points: points || 1,
      explanation: explanation || "",
      order: orderValue,
      imageUrl: imageUrl || "",
      questionBankId: resolvedQBId,
      sectionId: resolvedSectionId,
      createdBy: user._id,
      createdByName: user.name || "",
      constraints: constraints || { wordLimit: null, difficultyLevel: "medium" },
    };

    const updated = await Exam.findByIdAndUpdate(
      exam._id,
      { $push: { questions: questionSnapshot }, $set: { updatedAt: new Date() } },
      { new: true }
    );

    res.status(201).json({
      exam: updated,
      addedQuestion: updated.questions[updated.questions.length - 1],
      ...(wasReplaced
        ? { replaced: true, message: "Existing question replaced and added to exam." }
        : { message: "Question added to exam successfully" }),
    });
  } catch (error) {
    console.error("Error adding question to exam:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// DELETE /api/exams/:examId/questions/:questionId — Atomically remove question from exam
router.delete("/:examId/questions/:questionId", verifyFirebaseToken, async (req, res) => {
  try {
    const result = await resolveExamAccess(req, res);
    if (!result) return;
    const { exam } = result;

    if (!isEditableStatus(exam)) {
      return res.status(400).json({ message: "Cannot remove questions from a published or closed exam." });
    }

    const updated = await Exam.findByIdAndUpdate(
      exam._id,
      {
        $pull: { questions: { _id: req.params.questionId } },
        $set: { updatedAt: new Date() },
      },
      { new: true }
    );

    res.json({ exam: updated, message: "Question removed from exam" });
  } catch (error) {
    console.error("Error removing question from exam:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// PUT /api/exams/:examId/questions/:questionId — Atomically update embedded question
router.put("/:examId/questions/:questionId", verifyFirebaseToken, async (req, res) => {
  try {
    const result = await resolveExamAccess(req, res);
    if (!result) return;
    const { exam } = result;

    if (!isEditableStatus(exam)) {
      return res.status(400).json({ message: "Cannot edit questions on a published or closed exam." });
    }

    const {
      question, type, options, correctAnswer, modelAnswer, points, explanation,
      constraints, imageUrl, contentType, codeSnippet, sectionId,
    } = req.body;

    if (sectionId !== undefined && sectionId !== null) {
      const section = exam.sections.id(sectionId);
      if (!section) {
        return res.status(400).json({ message: "Section not found on this exam." });
      }
    }

    if (type === "mcq" && Array.isArray(options)) {
      if (options.filter(o => o.trim()).length < 2) {
        return res.status(400).json({ message: "MCQ requires at least 2 options." });
      }
      if (correctAnswer !== undefined && !options.includes(correctAnswer)) {
        return res.status(400).json({ message: "Correct answer must match one of the options." });
      }
    }

    const updateFields = {};
    if (question !== undefined) updateFields["questions.$.question"] = question;
    if (type !== undefined) updateFields["questions.$.type"] = type;
    if (options !== undefined) updateFields["questions.$.options"] = options;
    if (correctAnswer !== undefined) updateFields["questions.$.correctAnswer"] = correctAnswer;
    if (modelAnswer !== undefined) updateFields["questions.$.modelAnswer"] = modelAnswer;
    if (points !== undefined) updateFields["questions.$.points"] = points;
    if (explanation !== undefined) updateFields["questions.$.explanation"] = explanation;
    if (constraints !== undefined) updateFields["questions.$.constraints"] = constraints;
    if (imageUrl !== undefined) updateFields["questions.$.imageUrl"] = imageUrl;
    if (contentType !== undefined) updateFields["questions.$.contentType"] = contentType === "code" ? "code" : "text";
    if (codeSnippet !== undefined) {
      updateFields["questions.$.codeSnippet.code"] = codeSnippet?.code || "";
      updateFields["questions.$.codeSnippet.language"] = codeSnippet?.language || "plaintext";
    }
    if (sectionId !== undefined) {
      updateFields["questions.$.sectionId"] = sectionId === null ? null : exam.sections.id(sectionId)._id;
    }
    updateFields.updatedAt = new Date();

    const updated = await Exam.findOneAndUpdate(
      { _id: exam._id, "questions._id": req.params.questionId },
      { $set: updateFields },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ message: "Question not found in exam" });
    }

    res.json({ exam: updated, message: "Question updated" });
  } catch (error) {
    console.error("Error updating exam question:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
