import React from "react";

const Skeleton = ({ className = "" }) => (
  <div
    aria-hidden="true"
    className={`rounded-sm bg-stone-200/70 ${className}`}
    style={{
      backgroundImage:
        "linear-gradient(90deg, #e7e5e4 25%, #f5f5f4 50%, #e7e5e4 75%)",
      backgroundSize: "800px 100%",
      animation: "shimmer 1.4s infinite linear",
    }}
  />
);

export const SkeletonText = ({ lines = 3, className = "" }) => (
  <div className={`space-y-2.5 ${className}`}>
    {Array.from({ length: lines }).map((_, i) => (
      <Skeleton
        key={i}
        className={`h-3.5 ${i === lines - 1 ? "w-2/3" : "w-full"}`}
      />
    ))}
  </div>
);

export default Skeleton;
