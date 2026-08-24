const mongoose = require("mongoose");

const questionSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ["mcq", "short_answer", "fill_blank", "true_false", "essay"],
    required: true,
  },
  question: {
    type: String,
    required: true,
  },
  // Rich content support — mirrors the embedded exam question sub-schema.
  contentType: {
    type: String,
    enum: ["text", "code"],
    default: "text",
  },
  codeSnippet: {
    code: {
      type: String,
      default: "",
    },
    language: {
      type: String,
      default: "plaintext",
    },
  },
  options: [
    {
      type: String,
    },
  ],
  correctAnswer: {
    type: String,
    required: true,
  },
  modelAnswer: {
    type: String,
    default: "", 
  },
  points: {
    type: Number,
    default: 1,
  },
  explanation: {
    type: String,
  },
  constraints: {
    wordLimit: {
      type: Number,
      default: null,
    },
    difficultyLevel: {
      type: String,
      enum: ["easy", "medium", "hard"],
      default: "medium",
    },
  },
  category: {
    type: String,
    default: "Aptitude",
  },
  topic: {
    type: String,
    default: "",
  },
  targetCompany: {
    type: String,
    default: "General",
  },
  tags: [
    {
      type: String,
    },
  ],
  imageUrl: {
    type: String,
    default: "",
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

questionSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model("Question", questionSchema);
