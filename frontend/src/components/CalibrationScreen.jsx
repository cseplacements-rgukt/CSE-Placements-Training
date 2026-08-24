import React, { useState, useEffect, useRef, useCallback } from "react";
import { examService } from "../services/examService";
import CameraFeed from "./CameraFeed";
import { loadFaceApi } from "../lib/faceApi";

const CalibrationScreen = ({ onCalibrationComplete, onCalibrationFailed, token, sessionId }) => {
  const [status, setStatus] = useState("loading"); // loading, calibrating, complete, error
  const [timeRemaining, setTimeRemaining] = useState(10);
  const [faceDetectionStats, setFaceDetectionStats] = useState({
    framesAnalyzed: 0,
    facesDetected: 0,
    detectionRate: 0,
    faceDistances: [],
    lightingLevels: [],
  });
  const [calibrationData, setCalibrationData] = useState(null);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const timerRef = useRef(null);
  const modelsLoadedRef = useRef(false);
  const isCalibrationCompleteRef = useRef(false);
  const statsCollectorRef = useRef({
    framesAnalyzed: 0,
    facesDetected: 0,
    faceDistances: [],
    lightingLevels: [],
    detectionTimestamps: [],
  });

  // Load face-api models ONCE on component mount
  useEffect(() => {
    // Prevent multiple load attempts
    if (modelsLoadedRef.current) return;

    const loadModels = async () => {
      try {
        console.log("Starting model load...");
        const faceapi = await loadFaceApi();
        // Load models from CDN
        const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/";
        await Promise.all([
          faceapi.nets.tinyFaceDetector.load(MODEL_URL),
          faceapi.nets.faceLandmark68Net.load(MODEL_URL),
          faceapi.nets.faceRecognitionNet.load(MODEL_URL),
        ]);

        console.log("Models loaded successfully");
        modelsLoadedRef.current = true;

        // Start calibration immediately
        setStatus("calibrating");
        setTimeRemaining(10);
      } catch (error) {
        console.error("Failed to load face detection models:", error);
        setStatus("error");
        onCalibrationFailed?.("Failed to load face detection models");
      }
    };

    loadModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency - run only once on mount

  // Start 10-second calibration timer - ONLY when calibrating starts
  useEffect(() => {
    if (status !== "calibrating") return;

    // Ensure timer starts at 10
    setTimeRemaining(10);

    let secondsRemaining = 10;

    timerRef.current = setInterval(() => {
      secondsRemaining--;
      setTimeRemaining(secondsRemaining);

      if (secondsRemaining <= 0) {
        clearInterval(timerRef.current);
        completeCalibration();
      }
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Calculate lighting level from canvas
  const calculateLightingLevel = (canvas) => {
    if (!canvas) return 0;
    const ctx = canvas.getContext("2d");
    const imageData = ctx.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    );
    const data = imageData.data;

    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
    }
    return sum / (data.length / 4);
  };

  // Calculate face distance (relative face size)
  const calculateFaceDistance = (detection) => {
    if (!detection) return 0;
    const faceVolume =
      detection.box.width * detection.box.height;
    return Math.sqrt(faceVolume);
  };

  // Frame processing callback - memoized to prevent CameraFeed re-renders
  const handleFrame = useCallback(async (video, canvas) => {
    if (
      !video ||
      !canvas ||
      status !== "calibrating" ||
      isCalibrationCompleteRef.current
    ) {
      return;
    }

    try {
      const faceapi = await loadFaceApi();
      const detections = await faceapi
        .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptors();

      const stats = statsCollectorRef.current;
      stats.framesAnalyzed++;

      // Draw face detections
      const displaySize = {
        width: canvas.width,
        height: canvas.height,
      };

      faceapi.matchDimensions(canvas, displaySize);
      const resizedDetections = faceapi.resizeResults(
        detections,
        displaySize
      );

      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Find the primary face (largest area)
      let largestFaceIndex = 0;
      let maxArea = 0;
      resizedDetections.forEach((detection, idx) => {
        const box = detection.detection.box;
        const area = box.width * box.height;
        if (area > maxArea) {
          maxArea = area;
          largestFaceIndex = idx;
        }
      });

      // Draw boxes and landmarks
      resizedDetections.forEach((detection, idx) => {
        const box = detection.detection.box;
        const isMainFace = idx === largestFaceIndex || resizedDetections.length === 1;
        const color = isMainFace ? "#00FF00" : "#FF0000";

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(
          box.x,
          box.y,
          box.width,
          box.height
        );

        // Draw landmarks
        if (detection.landmarks) {
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.5;
          detection.landmarks.positions.forEach((point) => {
            ctx.fillRect(point.x - 2, point.y - 2, 4, 4);
          });
          ctx.globalAlpha = 1;
        }
      });

      // Track maximum simultaneous faces
      stats.maxSimultaneousFaces = Math.max(stats.maxSimultaneousFaces || 0, detections.length);

      // Collect calibration data
      if (detections.length === 1) {
        const detection = detections[0];
        stats.facesDetected++;
        stats.detectionTimestamps.push(Date.now());

        const faceDistance = calculateFaceDistance(detection.detection);
        stats.faceDistances.push(faceDistance);

        const lightingLevel = calculateLightingLevel(canvas);
        stats.lightingLevels.push(lightingLevel);
      } else if (detections.length > 1) {
        // Multiple faces detected - not ideal for calibration
        ctx.fillStyle =
          "rgba(255, 0, 0, 0.3)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#FF0000";
        ctx.font = "16px Arial";
        ctx.fillText(
          `Multiple faces detected (${detections.length})`,
          10,
          30
        );
      }

      // Update stats UI periodically
      if (stats.framesAnalyzed % 10 === 0) {
        setFaceDetectionStats({
          framesAnalyzed: stats.framesAnalyzed,
          facesDetected: stats.facesDetected,
          detectionRate: Math.round(
            (stats.facesDetected / stats.framesAnalyzed) * 100
          ),
          faceDistances: stats.faceDistances,
          lightingLevels: stats.lightingLevels,
        });
      }
    } catch (error) {
      console.error("Error detecting faces:", error);
    }
  }, [status]);

  // Complete calibration and send data to backend
  const completeCalibration = async () => {
    if (isCalibrationCompleteRef.current) return;
    isCalibrationCompleteRef.current = true;
    clearInterval(timerRef.current);
    setStatus("complete");

    try {
      const stats = statsCollectorRef.current;

      // Calculate calibration thresholds
      const avgDistance =
        stats.faceDistances.length > 0
          ? stats.faceDistances.reduce((a, b) => a + b, 0) /
            stats.faceDistances.length
          : 0;

      const avgLighting =
        stats.lightingLevels.length > 0
          ? stats.lightingLevels.reduce((a, b) => a + b, 0) /
            stats.lightingLevels.length
          : 0;

      const detectionRate = stats.framesAnalyzed > 0
        ? Math.round((stats.facesDetected / stats.framesAnalyzed) * 100)
        : 0;

      const calibrationData = {
        status: "calibrated",
        timestamp: new Date(),
        duration: 10,
        framesAnalyzed: stats.framesAnalyzed,
        facesDetected: stats.maxSimultaneousFaces || 0,
        detectionRate,
        thresholds: {
          minFaceDistance: avgDistance * 0.8,
          maxFaceDistance: avgDistance * 1.2,
          minLighting: Math.max(0, avgLighting - 30),
          maxLighting: Math.min(255, avgLighting + 30),
        },
        environment: {
          lighting: {
            average: Math.round(avgLighting),
            min: Math.round(
              Math.min(...stats.lightingLevels)
            ),
            max: Math.round(
              Math.max(...stats.lightingLevels)
            ),
          },
          distance: {
            average: Math.round(avgDistance),
            min: Math.round(
              Math.min(...stats.faceDistances)
            ),
            max: Math.round(
              Math.max(...stats.faceDistances)
            ),
          },
        },
      };

      setCalibrationData(calibrationData);

      // Send calibration data to backend
      try {
        const authToken = typeof token === 'function' ? await token() : token;
        const result = await examService.saveCalibration(
          authToken,
          sessionId,
          calibrationData
        );

        // Save session data so the "Continue to Exam" button can utilize it
        setCalibrationData(prev => ({
          ...prev,
          session: result.session
        }));
      } catch (error) {
        console.error("Error saving calibration data:", error);
        setStatus("error");
        onCalibrationFailed?.(error.message);
      }
    } catch (error) {
      console.error("Error completing calibration:", error);
      setStatus("error");
      onCalibrationFailed?.(error.message);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-8">
      <div className="w-full max-w-xl rounded-lg border border-line bg-surface p-6 shadow-sm sm:p-8">
        <div className="text-center">
          <h1 className="text-[20px] font-bold tracking-tight text-ink">Camera Calibration</h1>
          <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-ink-muted">
            We're calibrating your camera for optimal face detection.
            Please position your face in the center and keep it steady.
          </p>
        </div>

        {status === "loading" && (
          <div className="mt-7 flex flex-col items-center gap-3 py-8">
            <span className="inline-block h-9 w-9 animate-[spin_0.7s_linear_infinite] rounded-full border-[3px] border-line border-t-primary" />
            <p className="text-sm font-medium text-ink">Loading face detection models…</p>
            <p className="text-xs text-ink-muted">This will start automatically in a moment…</p>
          </div>
        )}

        {status === "calibrating" && (
          <div className="mt-6">
            <CameraFeed
              videoRef={videoRef}
              canvasRef={canvasRef}
              isActive={true}
              showCanvas={true}
              width={640}
              height={480}
              onFrame={handleFrame}
            />

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 rounded-sm bg-primary-light px-3.5 py-2">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-ink-muted">
                  <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
                </svg>
                <span className="text-sm font-medium tabular-nums text-ink">
                  Starting in {timeRemaining}s
                </span>
              </div>
              <div className="flex items-center gap-2 rounded-sm border border-line px-3.5 py-2">
                <span className="text-xs uppercase tracking-wide text-ink-muted">Frames</span>
                <span className="text-sm font-semibold tabular-nums text-ink">
                  {faceDetectionStats.framesAnalyzed}
                </span>
              </div>
            </div>

            <ul className="mt-5 space-y-1.5 rounded-sm bg-canvas p-4 text-[13px] leading-relaxed text-stone-600">
              <li className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent" />
                Keep your face centered in the frame
              </li>
              <li className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent" />
                Ensure adequate lighting
              </li>
              <li className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent" />
                Avoid wearing sunglasses or hats
              </li>
              <li className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent" />
                Keep a neutral facial expression
              </li>
            </ul>
          </div>
        )}

        {status === "complete" && (
          <div className="mt-7 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-50 text-success">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h2 className="text-[17px] font-semibold text-ink">Calibration Complete!</h2>
            <p className="mt-1 text-sm text-ink-muted">Your camera has been calibrated successfully.</p>

            {calibrationData && (
              <>
                <dl className="mt-5 grid grid-cols-3 divide-x divide-line rounded-md border border-line py-3.5">
                  <div>
                    <dd className="text-lg font-bold tabular-nums text-ink">{calibrationData.facesDetected}</dd>
                    <dt className="mt-0.5 text-xs text-ink-muted">Faces Detected</dt>
                  </div>
                  <div>
                    <dd className="text-lg font-bold tabular-nums text-ink">{calibrationData.detectionRate}%</dd>
                    <dt className="mt-0.5 text-xs text-ink-muted">Detection Rate</dt>
                  </div>
                  <div>
                    <dd className="text-lg font-bold tabular-nums text-ink">
                      {calibrationData.environment.lighting.average < 100
                        ? "Low"
                        : calibrationData.environment.lighting.average < 180
                        ? "Medium"
                        : "High"}
                    </dd>
                    <dt className="mt-0.5 text-xs text-ink-muted">
                      Lighting ({calibrationData.environment.lighting.average})
                    </dt>
                  </div>
                </dl>

                <button
                  type="button"
                  onClick={() => onCalibrationComplete?.(calibrationData.session)}
                  disabled={!calibrationData.session}
                  className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 whitespace-nowrap rounded-sm bg-primary text-[15px] font-medium text-white shadow-sm transition-colors duration-150 hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 sm:w-auto sm:px-6"
                >
                  {calibrationData.session ? "Continue to Exam" : "Saving…"}
                </button>
              </>
            )}
          </div>
        )}

        {status === "error" && (
          <div className="mt-7 rounded-md border border-red-200 bg-red-50/60 p-5 text-center">
            <p className="text-sm font-medium text-danger">Calibration failed. Please try again.</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 inline-flex h-9 items-center justify-center rounded-sm border border-red-200 bg-surface px-4 text-sm font-medium text-danger transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default CalibrationScreen;
