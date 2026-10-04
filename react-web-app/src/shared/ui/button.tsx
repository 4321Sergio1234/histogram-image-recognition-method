import type { ComponentProps, ReactNode } from 'react';

type ButtonProps = ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary' | 'text' | 'link';
  icon?: ReactNode;
  trailingIcon?: ReactNode;
};

export function Button({
  variant = 'primary',
  icon,
  trailingIcon,
  children,
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${variant === 'link' ? 'text-link' : `button button-${variant}`} ${className}`.trim()}
      {...props}
    >
      {icon}
      {children}
      {trailingIcon}
    </button>
  );
}

type IconButtonProps = Omit<ComponentProps<'button'>, 'aria-label'> & { label: string };

export function IconButton({ label, className = '', type = 'button', ...props }: IconButtonProps) {
  return (
    <button
      type={type}
      className={`icon-button ${className}`.trim()}
      aria-label={label}
      {...props}
    />
  );
}
