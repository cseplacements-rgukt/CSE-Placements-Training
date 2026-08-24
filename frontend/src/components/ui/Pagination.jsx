import React from "react";
import Button from "./Button";
const Pagination = ({ page, pageCount, onPageChange, className = "" }) => {
  if (pageCount <= 1) return null;

  const windowSize = 5;
  let start = Math.max(1, page - Math.floor(windowSize / 2));
  const end = Math.min(pageCount, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i);

  const navBtn =
    "flex h-8 min-w-8 items-center justify-center rounded-sm border border-line px-2 text-[13px] font-medium text-ink transition-colors hover:bg-primary-light disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

  return (
    <nav
      aria-label="Pagination"
      className={`flex items-center justify-between gap-3 pt-3 ${className}`}
    >
      <span className="text-[13px] text-ink-muted">
        Page {page} of {pageCount}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className={navBtn}
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          Prev
        </button>
        {pages.map((p) =>
          p === page ? (
            <Button key={p} size="sm" variant="primary" aria-current="page" className="min-w-8 px-2">
              {p}
            </Button>
          ) : (
            <button
              key={p}
              type="button"
              className={`${navBtn} bg-surface`}
              onClick={() => onPageChange(p)}
            >
              {p}
            </button>
          )
        )}
        <button
          type="button"
          className={navBtn}
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pageCount}
          aria-label="Next page"
        >
          Next
        </button>
      </div>
    </nav>
  );
};

export default Pagination;
