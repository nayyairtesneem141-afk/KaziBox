import React, { forwardRef } from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, helperText, error, leftIcon, rightIcon, className = '', id, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    return (
      <div className="w-full flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-semibold text-[#1F2937]">
            {label}
            {props.required && <span className="text-red-500 ml-1">*</span>}
          </label>
        )}
        <div className="relative flex items-center">
          {leftIcon && (
            <div className="absolute left-3.5 pointer-events-none text-[#6B7280]">
              {leftIcon}
            </div>
          )}
          <input
            id={inputId}
            ref={ref}
            className={`w-full min-h-[46px] px-4 py-2.5 rounded-xl border bg-white text-base text-[#1F2937] placeholder-[#9CA3AF] transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--kazibox-primary,#6D28D9)] focus:border-transparent disabled:bg-[#F3F4F6] disabled:text-[#9CA3AF] disabled:cursor-not-allowed ${
              leftIcon ? 'pl-11' : ''
            } ${rightIcon ? 'pr-11' : ''} ${
              error ? 'border-red-500 focus:ring-red-500' : 'border-[var(--kazibox-border,#E5E7EB)] hover:border-[#D1D5DB]'
            } ${className}`}
            {...props}
          />
          {rightIcon && (
            <div className="absolute right-3.5 pointer-events-none text-[#6B7280]">
              {rightIcon}
            </div>
          )}
        </div>
        {error && <p className="text-sm font-medium text-red-600">{error}</p>}
        {!error && helperText && <p className="text-xs text-[#6B7280]">{helperText}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
