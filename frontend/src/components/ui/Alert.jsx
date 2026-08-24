import React from "react";

const Alert = ({ variant = "info", title, children, className = "", onDismiss }) => {
  const styles = {
    error: "bg-red-50 border-danger text-red-800",
    success: "bg-green-50 border-success text-green-800",
    warning: "bg-amber-50 border-warning text-amber-900",
    info: "bg-sky-50 border-info text-sky-900",
  };

  const iconColor = {
    error: "text-danger",
    success: "text-success",
    warning: "text-warning",
    info: "text-info",
  };

  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={`flex items-start gap-3 rounded-sm border-l-[3px] px-4 py-3 text-sm ${styles[variant] || styles.info} ${className}`}
    >
      {variant === "success" ? (
        <svg className={`mt-0.5 shrink-0 ${iconColor[variant]}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      ) : variant === "error" ? (
        <svg className={`mt-0.5 shrink-0 ${iconColor[variant]}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      ) : (
        <svg className={`mt-0.5 shrink-0 ${iconColor[variant]}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      )}
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        <div className="[&_strong]:font-semibold">{children}</div>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded-sm p-0.5 opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );
};

export default Alert;
