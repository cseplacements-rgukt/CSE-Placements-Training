const mongoose = require("mongoose");

const registrationAttemptSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    index: true,
  },
  attemptedAt: {
    type: Date,
    default: Date.now,
  },
});

// TTL index: automatically remove documents after 24 hours
registrationAttemptSchema.index({ attemptedAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model("RegistrationAttempt", registrationAttemptSchema);
