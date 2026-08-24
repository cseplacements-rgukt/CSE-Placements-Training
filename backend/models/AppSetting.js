const mongoose = require("mongoose");

// Simple key/value store for platform-level settings that admins manage
// from the UI (e.g. the shared exam-cell password hash). Values are opaque
// to this model; consumers decide the shape.
const appSettingSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
  },
  value: mongoose.Schema.Types.Mixed,
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

appSettingSchema.statics.setValue = async function (key, value) {
  return this.findOneAndUpdate(
    { key },
    { key, value, updatedAt: new Date() },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
};

appSettingSchema.statics.getValue = async function (key) {
  const doc = await this.findOne({ key });
  return doc ? doc.value : null;
};

module.exports = mongoose.model("AppSetting", appSettingSchema);
