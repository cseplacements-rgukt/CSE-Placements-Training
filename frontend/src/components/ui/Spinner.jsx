import React from "react";

const Spinner = ({ size = 24, className = "", label }) => (
  <span
    role="status"
    aria-label={label || "Loading"}
    className={`inline-block animate-[spin_0.7s_linear_infinite] rounded-full border-2 border-line border-t-primary ${className}`}
    style={{ width: size, height: size }}
  />
);

export const LoadingScreen = ({ message = "Loading…" }) => (
  <div className="flex min-h-[60vh] w-full flex-col items-center justify-center gap-3 text-sm font-medium text-ink-muted">
    <Spinner size={28} />
    <p>{message}</p>
  </div>
);

export default Spinner;
