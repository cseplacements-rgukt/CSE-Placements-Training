import React, { useId } from "react";

const FIELD_BASE =
  "w-full rounded-sm border bg-surface px-3 text-sm text-ink transition-colors duration-150 " +
  "placeholder:text-stone-400 disabled:bg-stone-50 disabled:text-ink-muted disabled:cursor-not-allowed " +
  "focus:outline-none focus:ring-2 focus:ring-accent/25 focus:border-accent";

const FIELD_ERROR =
  "border-danger focus:border-danger focus:ring-danger/25";

const FIELD_SIZES = {
  sm: "h-8 px-2.5 text-[13px]",
  md: "h-10",
};

const FieldWrapper = ({ label, hint, error, htmlFor, children }) => (
  <div className="w-full">
    {label && (
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block text-sm font-medium text-ink"
      >
        {label}
      </label>
    )}
    {children}
    {error ? (
      <p className="mt-1.5 flex items-center gap-1 text-[13px] text-danger" role="alert">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        {error}
      </p>
    ) : (
      hint && <p className="mt-1.5 text-[13px] text-ink-muted">{hint}</p>
    )}
  </div>
);

export const Input = ({
  label,
  hint,
  error,
  size = "md",
  className = "",
  ...rest
}) => {
  const id = useId();
  return (
    <FieldWrapper label={label} hint={hint} error={error} htmlFor={rest.id || id}>
      <input
        id={rest.id || id}
        aria-invalid={!!error}
        className={`${FIELD_BASE} ${FIELD_SIZES[size]} ${error ? FIELD_ERROR : "border-line"} ${className}`}
        {...rest}
      />
    </FieldWrapper>
  );
};

export const Select = ({
  label,
  hint,
  error,
  size = "md",
  className = "",
  children,
  ...rest
}) => {
  const id = useId();
  return (
    <FieldWrapper label={label} hint={hint} error={error} htmlFor={rest.id || id}>
      <select
        id={rest.id || id}
        aria-invalid={!!error}
        className={`${FIELD_BASE} ${FIELD_SIZES[size]} pr-8 ${error ? FIELD_ERROR : "border-line"} ${className}`}
        {...rest}
      >
        {children}
      </select>
    </FieldWrapper>
  );
};

export const Textarea = ({ label, hint, error, rows = 3, className = "", ...rest }) => {
  const id = useId();
  return (
    <FieldWrapper label={label} hint={hint} error={error} htmlFor={rest.id || id}>
      <textarea
        id={rest.id || id}
        rows={rows}
        aria-invalid={!!error}
        className={`${FIELD_BASE} py-2 leading-relaxed ${error ? FIELD_ERROR : "border-line"} ${className}`}
        {...rest}
      />
    </FieldWrapper>
  );
};

const InputGroup = ({ label, hint, error, children, className = "" }) => (
  <div className={`w-full ${className}`}>
    {label && (
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
    )}
    {children}
    {error ? (
      <p className="mt-1.5 flex items-center gap-1 text-[13px] text-danger" role="alert">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        {error}
      </p>
    ) : (
      hint && <p className="mt-1.5 text-[13px] text-ink-muted">{hint}</p>
    )}
  </div>
);

export const FileInput = React.forwardRef(function FileInput(
  { label, hint, error, className = "", ...rest },
  ref
) {
  return (
    <InputGroup label={label} hint={hint} error={error}>
      <input
        ref={ref}
        type="file"
        className={`w-full text-sm text-ink-muted file:mr-3 file:h-8 file:cursor-pointer file:rounded-sm file:border-0 file:bg-primary-light file:px-3 file:text-[13px] file:font-medium file:text-ink hover:file:bg-stone-200 ${className}`}
        {...rest}
      />
    </InputGroup>
  );
});

export default Input;
