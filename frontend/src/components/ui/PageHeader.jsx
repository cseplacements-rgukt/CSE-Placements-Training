import React from "react";

const PageHeader = ({ title, subtitle, actions, className = "" }) => (
  <div
    className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${className}`}
  >
    <div className="min-w-0">
      <h1 className="text-[24px] font-bold leading-tight tracking-tight text-ink">
        {title}
      </h1>
      {subtitle && (
        <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>
      )}
    </div>
    {actions && <div className="flex shrink-0 items-center gap-2.5">{actions}</div>}
  </div>
);

export default PageHeader;
