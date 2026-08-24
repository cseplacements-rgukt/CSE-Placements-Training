const express = require("express");
const router = express.Router();
const multer = require("multer");
const verifyFirebaseToken = require("../middleware/auth");
const User = require("../models/User");
const cloudinary = require("../config/cloudinary");

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

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only PNG, JPG, WEBP or GIF images are allowed"));
  },
});

// POST /api/uploads/image - Upload question image to Cloudinary
router.post("/image", verifyFirebaseToken, requireAdmin, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No image file provided" });
    }

    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "questions/images", resource_type: "image" },
        (error, uploaded) => (error ? reject(error) : resolve(uploaded))
      );
      stream.end(req.file.buffer);
    });

    res.json({ url: result.secure_url, publicId: result.public_id });
  } catch (error) {
    console.error("Image upload failed:", error);
    res.status(500).json({ message: "Image upload failed", error: error.message });
  }
});

// Multer/validation errors
router.use((err, req, res, next) => {
  const status = err.code === "LIMIT_FILE_SIZE" ? 413 : err.message.includes("allowed") ? 400 : 500;
  res.status(status).json({ message: err.message || "Upload error" });
});

module.exports = router;
