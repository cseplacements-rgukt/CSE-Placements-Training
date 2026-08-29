import React, { useEffect, useRef, useState } from "react";

/**
 * Self-contained countdown: ticks in its own local state so a once-per-second
 * update never re-renders the surrounding exam page. Parent only hears about
 * milestone warnings and time-up through stable callbacks.
 * serverOffsetMs = serverTimeMs - Date.now() at sync moment. If provided the
 * timer uses server-corrected now, so a wrong laptop clock cannot auto-submit
 * early or hide the timer.
 */
const ExamTimer = ({ endAt, onTimeUp, onMilestone, serverOffsetMs = 0 }) => {
  const getNowMs = () => Date.now() + (Number(serverOffsetMs) || 0);
  const computeRemaining = () =>
    endAt ? Math.max(0, Math.floor((endAt - getNowMs()) / 1000)) : 0;

  const [remaining, setRemaining] = useState(computeRemaining);
  const firedRef = useRef({});
  const onTimeUpRef = useRef(onTimeUp);
  const onMilestoneRef = useRef(onMilestone);
  const offsetRef = useRef(serverOffsetMs);

  useEffect(() => {
    onTimeUpRef.current = onTimeUp;
  }, [onTimeUp]);
  useEffect(() => {
    onMilestoneRef.current = onMilestone;
  }, [onMilestone]);
  useEffect(() => {
    offsetRef.current = serverOffsetMs;
    // Re-sync remaining immediately when offset updates (e.g. after clock sync)
    setRemaining(computeRemaining());
  }, [serverOffsetMs]);

  useEffect(() => {
    if (!endAt) return undefined;

    const tick = () => {
      const nowMs = Date.now() + (Number(offsetRef.current) || 0);
      const secs = endAt ? Math.max(0, Math.floor((endAt - nowMs) / 1000)) : 0;
      setRemaining(secs);

      if (secs <= 0) {
        clearInterval(timer);
        onTimeUpRef.current?.();
        return;
      }
      if (secs <= 300 && !firedRef.current.fiveMin) {
        firedRef.current.fiveMin = true;
        onMilestoneRef.current?.(300);
      }
      if (secs <= 60 && !firedRef.current.oneMin) {
        firedRef.current.oneMin = true;
        onMilestoneRef.current?.(60);
      }
    };

    const timer = setInterval(tick, 1000);
    tick();
    return () => clearInterval(timer);
  }, [endAt]);

  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const secs = remaining % 60;
  const formatted = [hours, minutes, secs]
    .map((v) => String(v).padStart(2, "0"))
    .join(":");

  let tone = "bg-surface border-line text-ink";
  if (remaining === 0) {
    tone = "bg-red-50 border-danger text-danger";
  } else if (remaining <= 60) {
    tone = "bg-red-50 border-danger text-danger";
  } else if (remaining <= 300) {
    tone = "bg-amber-50 border-warning text-warning";
  }

  return (
    <div
      role="timer"
      aria-label={`Time remaining ${formatted}`}
      className={`flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 transition-colors duration-200 ${tone}`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
      <span className="font-mono text-sm font-semibold tabular-nums">{formatted}</span>
    </div>
  );
};

export default ExamTimer;
