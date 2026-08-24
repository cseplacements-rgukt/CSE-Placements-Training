import React from "react";

export const Card = ({ className = "", children, ...rest }) => (
  <div
    className={`bg-surface border border-line rounded-md shadow-sm ${className}`}
    {...rest}
  >
    {children}
  </div>
);

export const CardHeader = ({ className = "", children, ...rest }) => (
  <div className={`px-5 pt-4 pb-3 ${className}`} {...rest}>
    {children}
  </div>
);

export const CardTitle = ({ className = "", children, ...rest }) => (
  <h3
    className={`text-[16px] font-semibold text-ink leading-snug ${className}`}
    {...rest}
  >
    {children}
  </h3>
);

export const CardBody = ({ className = "", children, ...rest }) => (
  <div className={`px-5 py-4 ${className}`} {...rest}>
    {children}
  </div>
);

export const CardFooter = ({ className = "", children, ...rest }) => (
  <div className={`px-5 py-3 border-t border-line ${className}`} {...rest}>
    {children}
  </div>
);

export default Card;
