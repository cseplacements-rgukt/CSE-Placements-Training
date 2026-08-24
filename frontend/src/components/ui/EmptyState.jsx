import React from "react";

const EmptyState = ({ icon, title, description, action, className = "" }) => (
  <div
    className={`flex flex-col items-center justify-center gap-2 px-6 py-14 text-center ${className}`}
  >
    {icon && (
      <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-primary-light text-ink-muted">
        {icon}
      </div>
    )}
    <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
    {description && (
      <p className="max-w-sm text-sm text-ink-muted">{description}</p>
    )}
    {action && <div className="mt-3">{action}</div>}
  </div>
);

export default EmptyState;
