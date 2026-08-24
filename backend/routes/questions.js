const express = require("express");
const router = express.Router();
const Question = require("../models/Question");
const User = require("../models/User");
const verifyFirebaseToken = require("../middleware/auth");

// Middleware to ensure user is platform staff (coordinator tier or above)
const requireAdmin = async (req, res, next) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || !["coordinator", "admin", "super_admin"].includes(user.role)) {
      return res.status(403).json({ message: "Access denied. Admins only." });
    }
    req.dbUser = user;
    next();
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// GET /api/questions - List questions (Admin only)
router.get("/", verifyFirebaseToken, requireAdmin, async (req, res) => {
  try {
    const { category, targetCompany, difficultyLevel } = req.query;
    const filter = {};
    if (category) filter.category = category;
    if (targetCompany) filter.targetCompany = targetCompany;
    if (difficultyLevel) filter["constraints.difficultyLevel"] = difficultyLevel;

    const questions = await Question.find(filter).sort({ createdAt: -1 });
    res.json({ questions });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// POST /api/questions - Create single question
router.post("/", verifyFirebaseToken, requireAdmin, async (req, res) => {
  try {
    const qData = { ...req.body, createdBy: req.dbUser._id };
    const question = new Question(qData);
    await question.save();
    res.status(201).json({ question, message: "Question created successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// PUT /api/questions/:id - Update question
router.put("/:id", verifyFirebaseToken, requireAdmin, async (req, res) => {
  try {
    const question = await Question.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!question) return res.status(404).json({ message: "Question not found" });
    res.json({ question, message: "Question updated" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// DELETE /api/questions/:id - Delete a question-bank item.
// The bank is shared platform data — deletion is super_admin exclusive.
router.delete("/:id", verifyFirebaseToken, requireAdmin, async (req, res) => {
  try {
    if (!req.dbUser || req.dbUser.role !== "super_admin") {
      return res.status(403).json({
        message: "Only a super admin can delete question-bank items",
      });
    }
    const question = await Question.findByIdAndDelete(req.params.id);
    if (!question) return res.status(404).json({ message: "Question not found" });
    res.json({ message: "Question deleted" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// POST /api/questions/import - Bulk import questions
router.post("/import", verifyFirebaseToken, requireAdmin, async (req, res) => {
  try {
    const { questions } = req.body;
    
    if (!Array.isArray(questions)) {
      return res.status(400).json({ success: false, message: "Invalid payload format. Expected { questions: [...] }" });
    }

    const BATCH_LIMIT = 200;
    if (questions.length > BATCH_LIMIT) {
      return res.status(400).json({ 
        success: false, 
        message: `Batch size exceeds limit of ${BATCH_LIMIT} questions.` 
      });
    }

    const errors = [];
    const validQuestions = [];
    const questionTexts = new Set(); // For catching duplicates within the batch

    // 1. In-memory validation
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.question || typeof q.question !== "string" || !q.question.trim()) {
        errors.push({ index: i, field: "question", message: "Question text is required." });
        continue;
      }
      if (!q.type || !["mcq", "short_answer", "fill_blank", "true_false", "essay"].includes(q.type)) {
        errors.push({ index: i, field: "type", message: "Valid question type is required." });
        continue;
      }
      if (!q.correctAnswer || typeof q.correctAnswer !== "string" || !q.correctAnswer.trim()) {
        errors.push({ index: i, field: "correctAnswer", message: "Correct answer is required." });
        continue;
      }
      if (q.type === "mcq") {
        if (!Array.isArray(q.options) || q.options.length < 2) {
          errors.push({ index: i, field: "options", message: "MCQ requires at least 2 options." });
          continue;
        }
        if (!q.options.includes(q.correctAnswer)) {
          errors.push({ index: i, field: "correctAnswer", message: "Correct answer must match one of the options." });
          continue;
        }
      }

      // Check intra-batch duplicate
      const duplicateKey = `${q.question.trim().toLowerCase()}_${(q.targetCompany || "General").trim().toLowerCase()}`;
      if (questionTexts.has(duplicateKey)) {
        errors.push({ index: i, field: "question", message: "Duplicate question within the import batch." });
        continue;
      }
      questionTexts.add(duplicateKey);

      validQuestions.push({
        ...q,
        createdBy: req.dbUser._id
      });
    }

    // 2. DB Duplicate Check (if memory validation passed)
    if (errors.length === 0) {
      const existingQuestions = await Question.find({
        question: { $in: validQuestions.map(vq => vq.question) }
      });

      for (let i = 0; i < validQuestions.length; i++) {
        const vq = validQuestions[i];
        const isDbDuplicate = existingQuestions.some(
          eq => eq.question === vq.question && eq.targetCompany === (vq.targetCompany || "General")
        );
        if (isDbDuplicate) {
          errors.push({ index: i, field: "question", message: "Question already exists in the database for this target company." });
        }
      }
    }

    // 3. Atomicity: Only insert if absolutely zero errors
    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        total: questions.length,
        valid: questions.length - errors.length,
        invalid: errors.length,
        errors,
        message: "Import failed due to validation errors."
      });
    }

    await Question.insertMany(validQuestions);

    res.status(201).json({
      success: true,
      total: questions.length,
      message: `${questions.length} questions imported successfully.`
    });

  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
