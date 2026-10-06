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
    'inline-flex items-center justify-center font-bold rounded-xl transition-all duration-200 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 select-none min-h-[44px] cursor-pointer';

  const sizeClasses = {
    sm: 'text-xs px-3.5 py-2 min-h-[44px] gap-1.5',
    md: 'text-sm px-5 py-2.5 min-h-[46px] gap-2 font-bold',
    lg: 'text-base px-6 py-3.5 min-h-[52px] gap-2.5 font-extrabold',
  };

  const variantClasses = {
    primary:
      'bg-gradient-to-r from-[#6D28D9] to-[#7C3AED] text-white hover:from-[#5B21B6] hover:to-[#6D28D9] focus:ring-[#6D28D9] shadow-[0_4px_14px_0_rgba(109,40,217,0.28)] hover:shadow-[0_6px_20px_rgba(109,40,217,0.38)]',
    secondary:
      'bg-gradient-to-r from-[#FACC15] to-[#FBBF24] text-[#1F2937] hover:from-[#EAB308] hover:to-[#F59E0B] focus:ring-[#FACC15] font-black shadow-[0_4px_14px_0_rgba(250,204,21,0.32)] hover:shadow-[0_6px_18px_rgba(250,204,21,0.4)]',
    outline:
      'border-2 border-[#E5E7EB] bg-white text-[#1F2937] hover:bg-[#F9FAFB] hover:border-[#CBD5E1] focus:ring-[#6D28D9] shadow-sm',
    ghost:
      'text-[#1F2937] hover:bg-[#F3E8FF] hover:text-[#6D28D9] focus:ring-[#6D28D9]',
    danger:
      'bg-gradient-to-r from-red-600 to-rose-600 text-white hover:from-red-700 hover:to-rose-700 focus:ring-red-500 shadow-[0_4px_14px_0_rgba(225,29,72,0.3)]',
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
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      ) : leftIcon ? (
        <span className="shrink-0">{leftIcon}</span>
      ) : null}

      <span>{children}</span>

      {rightIcon && !isLoading && <span className="shrink-0">{rightIcon}</span>}
    </button>
  );
};
