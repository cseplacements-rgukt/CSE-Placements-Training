import React, { useCallback, useEffect } from "react";

const Modal = ({ open, onClose, title, subtitle, size = "md", children, footer }) => {
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Escape") onClose?.();
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return undefined;
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  const sizes = {
    sm: "max-w-md",
    md: "max-w-xl",
    lg: "max-w-3xl",
    xl: "max-w-5xl",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : undefined}
    >
      <div
        className={`w-full ${sizes[size] || sizes.md} max-h-[88vh] flex flex-col bg-surface rounded-lg border border-line shadow-md`}
      >
        {(title || onClose) && (
          <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-line">
            <div className="min-w-0">
              {title && (
                <h2 className="text-[17px] font-semibold text-ink truncate">{title}</h2>
              )}
              {subtitle && (
                <p className="mt-0.5 text-[13px] text-ink-muted truncate">{subtitle}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="shrink-0 -mr-1 -mt-1 flex h-8 w-8 items-center justify-center rounded-sm text-ink-muted transition-colors hover:bg-primary-light hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}
        <div className="overflow-y-auto px-6 py-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-3 border-t border-line px-6 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

export default Modal;
