import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  padding?: 'none' | 'sm' | 'md' | 'lg';
  hoverEffect?: boolean;
}

export const Card: React.FC<CardProps> = ({
  children,
  padding = 'md',
  hoverEffect = false,
  className = '',
  ...props
}) => {
  const paddingMap = {
    none: '',
    sm: 'p-4',
    md: 'p-6',
    lg: 'p-7 sm:p-8',
  };

  const hoverClass = hoverEffect
    ? 'transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_16px_32px_-8px_rgba(109,40,217,0.12),0_4px_12px_-2px_rgba(0,0,0,0.04)] hover:border-[#DDD6FE]'
    : '';

  return (
    <div
      className={`bg-white rounded-3xl border border-[#E5E7EB] shadow-[0_2px_10px_-2px_rgba(0,0,0,0.04),0_1px_4px_-1px_rgba(0,0,0,0.02)] ${paddingMap[padding]} ${hoverClass} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};

export const CardHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  children,
  className = '',
  ...props
}) => (
  <div className={`border-b border-[#E5E7EB] pb-4 mb-5 ${className}`} {...props}>
    {children}
  </div>
);

export const CardTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({
  children,
  className = '',
  ...props
}) => (
  <h3 className={`text-xl font-black text-[#1F2937] tracking-tight ${className}`} {...props}>
    {children}
  </h3>
);

export const CardDescription: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({
  children,
  className = '',
  ...props
}) => (
  <p className={`text-sm text-[#6B7280] mt-1 leading-relaxed ${className}`} {...props}>
    {children}
  </p>
);

export const CardContent: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  children,
  className = '',
  ...props
}) => (
  <div className={`text-[#374151] ${className}`} {...props}>
    {children}
  </div>
);

export const CardFooter: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  children,
  className = '',
  ...props
}) => (
  <div className={`border-t border-[#E5E7EB] pt-4 mt-5 flex items-center justify-between ${className}`} {...props}>
    {children}
  </div>
);
