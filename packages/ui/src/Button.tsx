import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  isLoading = false,
  leftIcon,
  rightIcon,
  className = '',
  disabled,
  ...props
}) => {
  const baseClasses =
    'inline-flex items-center justify-center font-medium rounded-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed select-none min-h-[44px]';

  const sizeClasses = {
    sm: 'text-sm px-3 py-2 min-h-[44px] gap-1.5',
    md: 'text-base px-5 py-2.5 min-h-[46px] gap-2 font-semibold',
    lg: 'text-lg px-6 py-3.5 min-h-[52px] gap-2.5 font-bold shadow-sm',
  };

  const variantClasses = {
    primary:
      'bg-[var(--kazibox-primary,#6D28D9)] text-white hover:bg-[var(--kazibox-primary-hover,#5B21B6)] focus:ring-[var(--kazibox-primary,#6D28D9)] shadow-sm hover:shadow',
    secondary:
      'bg-[var(--kazibox-accent,#FACC15)] text-[#1F2937] hover:bg-[#EAB308] focus:ring-[#FACC15] font-bold shadow-sm',
    outline:
      'border-2 border-[var(--kazibox-border,#E5E7EB)] bg-white text-[#1F2937] hover:bg-[#F9FAFB] hover:border-[#D1D5DB] focus:ring-[var(--kazibox-primary,#6D28D9)]',
    ghost:
      'text-[#1F2937] hover:bg-[var(--kazibox-primary-soft,#F3E8FF)] hover:text-[var(--kazibox-primary,#6D28D9)] focus:ring-[var(--kazibox-primary,#6D28D9)]',
    danger:
      'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500 shadow-sm',
  };

  const widthClass = fullWidth ? 'w-full' : '';

  return (
    <button
      className={`${baseClasses} ${sizeClasses[size]} ${variantClasses[variant]} ${widthClass} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <svg
          className="animate-spin -ml-1 mr-2 h-5 w-5 text-current"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          ></circle>
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          ></path>
        </svg>
      ) : (
        leftIcon && <span className="inline-flex shrink-0">{leftIcon}</span>
      )}
      <span>{children}</span>
      {!isLoading && rightIcon && (
        <span className="inline-flex shrink-0">{rightIcon}</span>
      )}
    </button>
  );
};
