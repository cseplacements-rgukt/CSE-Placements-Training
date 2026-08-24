const express = require("express");
const cors = require("cors");
const compression = require("compression");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
const connectDB = require("./config/db");

dotenv.config();

const app = express();

// Behind Nginx on the Hostinger VPS, Express must read the real client IP
// from X-Forwarded-For instead of seeing 127.0.0.1 for every request.
// TRUST_PROXY = number of proxy hops (Nginx on same box => 1). Set to 0 only
// when exposing Node directly (no proxy).
const TRUST_PROXY_HOPS = parseInt(process.env.TRUST_PROXY || "1", 10);
if (TRUST_PROXY_HOPS > 0) {
  app.set("trust proxy", TRUST_PROXY_HOPS);
}

// Middleware
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);
      // Allow any localhost port
      if (/^http:\/\/localhost:\d+$/.test(origin)) {
        return callback(null, true);
      }
      // Allow production frontend (handles comma-separated, trailing slashes, and paths)
      if (process.env.FRONTEND_URL) {
        const allowedOrigins = process.env.FRONTEND_URL.split(',').map(url => {
          try {
            return new URL(url.trim()).origin;
          } catch (e) {
            return url.trim().replace(/\/$/, "");
          }
        });
        
        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
      }
      
      console.warn(`CORS Error: Origin ${origin} not allowed`);
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);
// Gzip API responses — JSON exam/submission payloads compress ~70-80%,
// which matters a lot on mobile hotspots with 150-200 concurrent students.
app.use(compression());

// Proctoring stores metadata only; accepting image-sized request bodies would
// unnecessarily expose the API to expensive uploads.
app.use(bodyParser.json({ limit: "1mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "1mb" }));

// Connect to database (only if not running tests, since tests use MongoMemoryServer)
if (process.env.NODE_ENV !== "test") {
  connectDB();
}

// Routes
app.use("/api/auth", require("./routes/auth"));
app.use("/api/exams", require("./routes/exams"));
// Classrooms feature was removed entirely (model + route deleted).
app.use("/api/submissions", require("./routes/submissions"));
app.use("/api/notifications", require("./routes/notifications"));
app.use("/api/proctoring", require("./routes/proctoring"));
app.use("/api/reports", require("./routes/reports"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/staff", require("./routes/staff"));
app.use("/api/students", require("./routes/students"));
app.use("/api/grading", require("./routes/grading"));
app.use("/api/uploads", require("./routes/uploads"));

// Grading is fully deterministic (no external services) — no queue needed.

app.get("/", (req, res) => {
  res.json({ message: "MOD-U-GO API is running", version: "2.0.0" });
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(err.status || 500).json({
  message: err.message || "Internal server error",
  stack: process.env.NODE_ENV === "development" ? err.stack : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

const PORT = process.env.PORT || 5000;

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  });
}

module.exports = app;
