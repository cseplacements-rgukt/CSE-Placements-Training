import React from "react";

const VARIANTS = {
  success: "bg-green-50 text-green-700 ring-1 ring-inset ring-green-600/20",
  warning: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/25",
  danger: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20",
  info: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-600/20",
  neutral: "bg-stone-100 text-stone-600 ring-1 ring-inset ring-stone-500/15",
  accent: "bg-accent-light text-accent-dark ring-1 ring-inset ring-accent/25",
};

const DOTS = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  accent: "bg-accent",
};

const Badge = ({ variant = "neutral", dot = false, className = "", children, ...rest }) => (
  <span
    className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
      VARIANTS[variant] || VARIANTS.neutral
    } ${className}`}
    {...rest}
  >
    {(dot || DOTS[variant]) && (
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${DOTS[variant] || "bg-stone-400"}`}
      />
    )}
    {children}
  </span>
);

export default Badge;
