import React, { useState, useEffect, useRef } from "react";

const CameraFeed = ({
  videoRef, 
  canvasRef, 
  isActive = true,
  showCanvas = false,
  width = 320,
  height = 240,
  onFrame = null 
}) => {
  const [error, setError] = useState(null);
  const animationFrameRef = useRef(null);
  const streamRef = useRef(null); // Store stream separately so cleanup can stop it even after DOM unmounts

  useEffect(() => {
    if (!isActive) return;

    // Capture the node now so cleanup works even after the ref detaches.
    const videoEl = videoRef.current;

    const startCamera = async () => {
      try {
        setError(null);
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: width },
            height: { ideal: height },
          },
          audio: false,
        });

        // Keep the raw stream in a ref so cleanup can always stop it.
        streamRef.current = stream;

        if (videoEl) {
          videoEl.srcObject = stream;
          videoEl.onloadedmetadata = () => {
            if (videoEl) {
              videoEl.play();
              if (canvasRef.current) {
                canvasRef.current.width = videoEl.videoWidth || width;
                canvasRef.current.height = videoEl.videoHeight || height;
              }
            }
          };
        }
      } catch (err) {
        console.error("Error accessing camera:", err);
        setError(
          err.name === "NotAllowedError"
            ? "Camera permission denied"
            : "Failed to access camera"
        );
      }
    };

    startCamera();

    return () => {
      // Stop via streamRef first — reliable even when the video node is gone.
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (videoEl) {
        videoEl.srcObject = null;
      }
    };
  }, [isActive, videoRef, canvasRef, width, height]);

  // Frame capture callback
  useEffect(() => {
    if (!isActive || !videoRef.current || !onFrame) return;

    let isProcessing = false;

    const captureFrame = async () => {
      // Check if video is actually playing/ready and we're not busy
      if (videoRef.current.readyState >= 2 && !isProcessing) {
        isProcessing = true;
        try {
          await onFrame(videoRef.current, canvasRef.current);
        } catch (err) {
          console.error("Frame processing error:", err);
        } finally {
          isProcessing = false;
        }
      }
      animationFrameRef.current = requestAnimationFrame(captureFrame);
    };

    animationFrameRef.current = requestAnimationFrame(captureFrame);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isActive, videoRef, canvasRef, onFrame]);

  return (
    <div className="camera-feed-container w-full">
      <div className="camera-wrapper relative mx-auto aspect-[4/3] w-full max-w-lg overflow-hidden rounded-md border border-line bg-stone-950">
        <video
          ref={videoRef}
          className="camera-video h-full w-full object-cover"
          autoPlay
          playsInline
          muted
          onContextMenu={(e) => e.preventDefault()}
        />
        {showCanvas && (
          <canvas
            ref={canvasRef}
            className="camera-canvas absolute left-0 top-0 block"
          />
        )}
        {error && (
          <div role="alert" className="camera-error absolute inset-0 flex items-center justify-center bg-stone-950/85 px-4 text-center text-sm font-medium text-red-300">
            {error}
          </div>
        )}
      </div>
    </div>
  );
};

export default CameraFeed;
