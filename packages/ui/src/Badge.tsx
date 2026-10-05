import React from 'react';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'yellow' | 'purple' | 'gray' | 'green' | 'red';
  size?: 'sm' | 'md';
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'yellow',
  size = 'md',
  className = '',
  ...props
}) => {
  const sizeMap = {
    sm: 'text-xs px-2.5 py-0.5 rounded-md font-semibold',
    md: 'text-sm px-3 py-1 rounded-lg font-bold',
  };

  // Rule: Yellow #FACC15 is paired strictly with dark text #1F2937, never light or white text!
  const variantMap = {
    yellow: 'bg-[#FACC15] text-[#1F2937] border border-[#EAB308]',
    purple: 'bg-[var(--kazibox-primary-soft,#F3E8FF)] text-[var(--kazibox-primary,#6D28D9)] border border-[#DDD6FE]',
    gray: 'bg-[#F3F4F6] text-[#4B5563] border border-[#E5E7EB]',
    green: 'bg-[#DCFCE7] text-[#166534] border border-[#BBF7D0]',
    red: 'bg-[#FEE2E2] text-[#991B1B] border border-[#FECACA]',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 leading-none tracking-wide select-none ${sizeMap[size]} ${variantMap[variant]} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
};
