import React, { useState, useRef } from 'react';

const VideoPlayer = ({ src, poster }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const videoRef = useRef(null);

  const handleCanPlay = () => {
    setLoading(false);
  };

  const handleWaiting = () => {
    setLoading(true);
  };

  const handlePlaying = () => {
    setLoading(false);
  };

  const handleError = () => {
    setLoading(false);
    setError(true);
  };

  return (
    <div className="relative aspect-video w-full bg-stone-950">
      {loading && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 text-[13px] text-stone-300">
          <span className="inline-block h-7 w-7 animate-[spin_0.7s_linear_infinite] rounded-full border-2 border-stone-600 border-t-white" />
          Processing video. Please wait…
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-[13px] text-stone-300">
          <p>Video is not ready yet or unavailable.</p>
          <button
            type="button"
            onClick={() => {
              setError(false);
              setLoading(true);
              if (videoRef.current) {
                videoRef.current.load();
              }
            }}
            className="h-8 rounded-sm bg-white/10 px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Retry
          </button>
        </div>
      )}

      <video
        ref={videoRef}
        src={src}
        poster={poster}
        controls
        preload="metadata"
        onCanPlay={handleCanPlay}
        onWaiting={handleWaiting}
        onPlaying={handlePlaying}
        onError={handleError}
        style={{ display: error ? 'none' : 'block' }}
        className="h-full w-full"
      />
    </div>
  );
};

export default VideoPlayer;
