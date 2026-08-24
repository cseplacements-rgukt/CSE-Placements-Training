import { useEffect, useState } from "react";

const useDebouncedValue = (value, delayMs = 350) => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
};

export default useDebouncedValue;
