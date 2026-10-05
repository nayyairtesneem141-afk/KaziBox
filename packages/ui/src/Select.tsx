import React, { forwardRef } from 'react';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  helperText?: string;
  error?: string;
  options: SelectOption[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, helperText, error, options, className = '', id, ...props }, ref) => {
    const selectId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    return (
      <div className="w-full flex flex-col gap-1.5">
        {label && (
          <label htmlFor={selectId} className="text-sm font-semibold text-[#1F2937]">
            {label}
            {props.required && <span className="text-red-500 ml-1">*</span>}
          </label>
        )}
        <div className="relative flex items-center">
          <select
            id={selectId}
            ref={ref}
            className={`w-full min-h-[46px] px-4 py-2.5 rounded-xl border bg-white text-base text-[#1F2937] transition-all duration-150 appearance-none focus:outline-none focus:ring-2 focus:ring-[var(--kazibox-primary,#6D28D9)] focus:border-transparent disabled:bg-[#F3F4F6] disabled:cursor-not-allowed pr-10 cursor-pointer ${
              error ? 'border-red-500 focus:ring-red-500' : 'border-[var(--kazibox-border,#E5E7EB)] hover:border-[#D1D5DB]'
            } ${className}`}
            {...props}
          >
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <div className="absolute right-3.5 pointer-events-none text-[#6B7280]">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
        {error && <p className="text-sm font-medium text-red-600">{error}</p>}
        {!error && helperText && <p className="text-xs text-[#6B7280]">{helperText}</p>}
      </div>
    );
  }
);

Select.displayName = 'Select';
