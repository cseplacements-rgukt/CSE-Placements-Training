import { useState } from "react";

const usePagedData = (items, pageSize = 25, resetKey) => {
  const [page, setPage] = useState(1);
  const [prevResetKey, setPrevResetKey] = useState(resetKey);

  // Adjust-state-during-render pattern: resets to page 1 whenever the
  // resetKey changes without an extra effect-driven render pass.
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    setPage(1);
  }

  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pagedItems = items.slice((safePage - 1) * pageSize, safePage * pageSize);
  return { page: safePage, pageCount, setPage, pagedItems };
};

export default usePagedData;
