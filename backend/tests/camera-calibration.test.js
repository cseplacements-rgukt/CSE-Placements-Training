// ═══════════════════════════════════════════════════════════════════
// CAMERA CALIBRATION BUSINESS LOGIC TESTS  (TC-048 → TC-052)
// ═══════════════════════════════════════════════════════════════════
// Pure unit tests for the helper functions extracted from
// CalibrationScreen.jsx — no DOM, no React, no face-api.js required.

// ─── Replicate helpers from CalibrationScreen.jsx ─────────────────

/**
 * Calculates average pixel brightness (0–255) from a canvas.
 * @param {HTMLCanvasElement|null} canvas
 * @returns {number}
 */
const calculateLightingLevel = (canvas) => {
  if (!canvas) return 0;
  const ctx = canvas.getContext("2d");
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
  }
  return sum / (data.length / 4);
};

/**
 * Calculates a "face distance" proxy as sqrt(width * height) of bounding box.
 * @param {{ box: { width: number, height: number } }|null} detection
 * @returns {number}
 */
const calculateFaceDistance = (detection) => {
  if (!detection) return 0;
  const faceVolume = detection.box.width * detection.box.height;
  return Math.sqrt(faceVolume);
};

/**
 * Builds calibration thresholds from an array of distances and lighting values.
 * @param {number[]} faceDistances
 * @param {number[]} lightingLevels
 * @returns {{ minFaceDistance: number, maxFaceDistance: number, minLighting: number, maxLighting: number }}
 */
const buildCalibrationThresholds = (faceDistances, lightingLevels) => {
  const avgDistance =
    faceDistances.length > 0
      ? faceDistances.reduce((a, b) => a + b, 0) / faceDistances.length
      : 0;

  const avgLighting =
    lightingLevels.length > 0
      ? lightingLevels.reduce((a, b) => a + b, 0) / lightingLevels.length
      : 0;

  return {
    minFaceDistance: avgDistance * 0.8,
    maxFaceDistance: avgDistance * 1.2,
    minLighting: Math.max(0, avgLighting - 30),
    maxLighting: Math.min(255, avgLighting + 30),
  };
};

/**
 * Calculates detection rate percentage (faces detected / frames analyzed).
 * @param {number} facesDetected
 * @param {number} framesAnalyzed
 * @returns {number} 0–100
 */
const calculateDetectionRate = (facesDetected, framesAnalyzed) => {
  if (framesAnalyzed === 0) return 0;
  return Math.round((facesDetected / framesAnalyzed) * 100);
};

// ═══════════════════════════════════════════════════════════════════
// TEST SUITES
// ═══════════════════════════════════════════════════════════════════

// ─── mock canvas helper ───────────────────────────────────────────
const makeCanvas = (r, g, b, pixelCount = 1) => {
  const pixels = new Uint8ClampedArray(pixelCount * 4);
  for (let i = 0; i < pixelCount; i++) {
    pixels[i * 4] = r;
    pixels[i * 4 + 1] = g;
    pixels[i * 4 + 2] = b;
    pixels[i * 4 + 3] = 255;
  }
  return {
    width: pixelCount,
    height: 1,
    getContext: () => ({
      getImageData: () => ({ data: pixels }),
    }),
  };
};

// TC-048 ─────────────────────────────────────────────────────────
describe("Camera Calibration: Lighting Level Calculation", () => {
  test("TC-048: should return 0 for a null canvas (null guard)", () => {
    expect(calculateLightingLevel(null)).toBe(0);
  });

  // TC-049
  test("TC-049: should return correct average pixel brightness for a solid-color canvas", () => {
    // Pure white pixel — average of (255+255+255)/3 = 255
    const canvas = makeCanvas(255, 255, 255);
    expect(calculateLightingLevel(canvas)).toBeCloseTo(255, 1);

    // Pure black pixel — average = 0
    const darkCanvas = makeCanvas(0, 0, 0);
    expect(calculateLightingLevel(darkCanvas)).toBeCloseTo(0, 1);
  });
});

// TC-050 ─────────────────────────────────────────────────────────
describe("Camera Calibration: Face Distance Calculation", () => {
  test("TC-050: should return 0 for a null detection (null guard)", () => {
    expect(calculateFaceDistance(null)).toBe(0);
  });

  // TC-051
  test("TC-051: should compute sqrt of bounding-box area for a valid detection", () => {
    const detection = { box: { width: 100, height: 100 } };
    // sqrt(100 * 100) = 100
    expect(calculateFaceDistance(detection)).toBeCloseTo(100, 1);

    const detection2 = { box: { width: 80, height: 60 } };
    // sqrt(80 * 60) = sqrt(4800) ≈ 69.28
    expect(calculateFaceDistance(detection2)).toBeCloseTo(Math.sqrt(4800), 1);
  });
});

// TC-052 ─────────────────────────────────────────────────────────
describe("Camera Calibration: Threshold Building & Detection Rate", () => {
  test("TC-052: should build thresholds as ±20% of average distance and ±30 of average lighting", () => {
    const distances = [100, 100, 100]; // avg = 100
    const lighting = [150, 150, 150]; // avg = 150

    const thresholds = buildCalibrationThresholds(distances, lighting);

    expect(thresholds.minFaceDistance).toBeCloseTo(80, 1);   // 100 * 0.8
    expect(thresholds.maxFaceDistance).toBeCloseTo(120, 1);  // 100 * 1.2
    expect(thresholds.minLighting).toBeCloseTo(120, 1);      // 150 - 30
    expect(thresholds.maxLighting).toBeCloseTo(180, 1);      // 150 + 30
  });
});
