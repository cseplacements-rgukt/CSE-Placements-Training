const mongoose = require("mongoose");

const loginAttemptSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    index: true,
  },
  attemptedAt: {
    type: Date,
    default: Date.now,
  },
  success: {
    type: Boolean,
    default: false,
  },
});

// TTL index: automatically remove documents after 1 hour
loginAttemptSchema.index({ attemptedAt: 1 }, { expireAfterSeconds: 3600 });

module.exports = mongoose.model("LoginAttempt", loginAttemptSchema);
