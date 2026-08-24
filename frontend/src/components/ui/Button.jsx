import React from "react";

const VARIANTS = {
  primary:
    "bg-primary text-white hover:bg-primary-dark active:bg-primary-dark shadow-sm",
  secondary:
    "bg-surface text-ink border border-line hover:bg-primary-light hover:border-stone-300",
  ghost: "text-ink-muted hover:bg-primary-light hover:text-ink",
  danger: "bg-danger text-white hover:bg-red-700 active:bg-red-700 shadow-sm",
  dangerGhost:
    "bg-surface text-danger border border-red-200 hover:bg-red-50",
};

const SIZES = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-5 text-[15px]",
};

const BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm font-medium transition-colors duration-150 select-none " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-canvas " +
  "disabled:opacity-50 disabled:pointer-events-none";

const Button = React.forwardRef(function Button(
  { variant = "primary", size = "md", className = "", type, children, ...rest },
  ref
) {
  const classes =
    `${BASE} ${VARIANTS[variant] || VARIANTS.primary} ${SIZES[size] || SIZES.md} ${className}`;
  return (
    <button ref={ref} type={type || "button"} className={classes} {...rest}>
      {children}
    </button>
  );
});

export default Button;
