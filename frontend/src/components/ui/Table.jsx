import React from "react";

const Table = ({ className = "", children }) => (
  <div className={`overflow-x-auto rounded-md border border-line bg-surface shadow-sm ${className}`}>
    <table className="w-full min-w-[640px] border-collapse text-left text-sm">
      {children}
    </table>
  </div>
);

const THead = ({ children }) => <thead>{children}</thead>;

const TRHead = ({ children }) => (
  <tr className="border-b border-line bg-stone-50">{children}</tr>
);

const TH = ({ className = "", children, ...rest }) => (
  <th
    scope="col"
    className={`whitespace-nowrap px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted ${className}`}
    {...rest}
  >
    {children}
  </th>
);

const TBody = ({ children }) => <tbody>{children}</tbody>;

const TR = ({ className = "", children, ...rest }) => (
  <tr
    className={`border-b border-line transition-colors last:border-b-0 hover:bg-amber-50/50 ${className}`}
    {...rest}
  >
    {children}
  </tr>
);

const TD = ({ className = "", children, ...rest }) => (
  <td className={`px-4 py-3 align-middle text-ink ${className}`} {...rest}>
    {children}
  </td>
);

export { Table, THead, TRHead, TH, TBody, TR, TD };
export default Table;
