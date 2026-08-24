/**
 * GazeTracker — Uses WebGazer.js to detect when a student's gaze leaves
 * the screen bounding box for more than 5 continuous seconds.
 *
 * Implements a "sustainment threshold" model: a violation is only flagged
 * once the gaze remains outside the viewport for an unbroken stretch that
 * exceeds DEVIATION_THRESHOLD_MS.  Brief glances away (< 5 s) reset the
 * timer and are not counted, reducing false positives.
 */
class GazeTracker {
  /** @param {{ onViolation: (details: string) => void }} opts */
  constructor({ onViolation }) {
    this.onViolation = onViolation;

    // Sustainment-threshold tunables
    this.DEVIATION_THRESHOLD_MS = 5000; // 5 continuous seconds
    this.POLL_INTERVAL_MS = 200; // how often we sample gaze
    this.COOLDOWN_MS = 20000; // wait between flagged violations (same event type)

    // Internal state
    this._deviationStart = null; // timestamp when gaze first left bounds
    this._pollTimer = null;
    this._started = false;
    this._webgazerReady = false;
    this._violationCount = 0;
    this._lastViolationAt = 0;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Initialise WebGazer and begin tracking. */
  async start() {
    if (this._started) return;
    this._started = true;

    try {
      // WebGazer attaches itself to `window` when imported.
      const webgazer = (await import("webgazer")).default;
      this._webgazer = webgazer;

      // Configure WebGazer – hide its default video/overlay UI
      webgazer
        .setRegression("ridge")
        .showVideoPreview(false)
        .showPredictionPoints(false)
        .showFaceOverlay(false)
        .showFaceFeedbackBox(false);

      await webgazer.begin();
      this._webgazerReady = true;

      // Start polling gaze coordinates
      this._pollTimer = setInterval(() => this.trackEyeMovement(), this.POLL_INTERVAL_MS);
    } catch (err) {
      console.error("[GazeTracker] Failed to initialise WebGazer:", err);
      this._started = false;
    }
  }

  /** Stop tracking and tear down WebGazer. */
  stop() {
    this._started = false;
    this._webgazerReady = false;
    this._deviationStart = null;

    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }

    try {
      this._webgazer?.end();
    } catch {
      // WebGazer may throw if already torn down
    }
    this._webgazer = null;
  }

  // ── Core detection ──────────────────────────────────────────────────────────

  /**
   * trackEyeMovement — called on every poll tick.
   *
   * 1. Reads the current gaze prediction from WebGazer.
   * 2. Checks whether the gaze point falls outside the viewport.
   * 3. If outside, starts (or continues) a deviation timer.
   * 4. When the timer exceeds DEVIATION_THRESHOLD_MS, fires onViolation
   *    exactly once per sustained deviation and resets.
   * 5. If gaze returns inside the viewport, resets the timer (no flag).
   */
  trackEyeMovement() {
    if (!this._webgazerReady || !this._webgazer) return;

    const prediction = this._webgazer.getCurrentPrediction();

    if (!prediction || prediction.x == null || prediction.y == null) {
      // No prediction available (e.g. face lost) — treat as off-screen
      this._handleOffScreen();
      return;
    }

    const { x, y } = prediction;
    const w = window.innerWidth;
    const h = window.innerHeight;

    const isOutside = x < 0 || y < 0 || x > w || y > h;

    if (isOutside) {
      this._handleOffScreen();
    } else {
      // Gaze is within screen — reset deviation timer
      this._deviationStart = null;
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  _handleOffScreen() {
    const now = Date.now();

    // Cooldown: after a violation fires, keep sampling but stay quiet for a
    // while so sustained off-screen gaze doesn't produce an event every 5s.
    if (now - this._lastViolationAt < this.COOLDOWN_MS) return;

    if (!this._deviationStart) {
      // First frame of a new potential deviation
      this._deviationStart = now;
      return;
    }

    const elapsed = now - this._deviationStart;

    if (elapsed >= this.DEVIATION_THRESHOLD_MS) {
      this._violationCount++;
      this._lastViolationAt = now;
      this._deviationStart = null;
      const seconds = Math.round(elapsed / 1000);
      this.onViolation(
        `Gaze outside screen for ${seconds}s (violation #${this._violationCount})`
      );
    }
  }
}

export default GazeTracker;
