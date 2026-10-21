import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'quiet' | 'danger';
  iconOnly?: boolean;
}

export const Button = ({ variant, iconOnly = false, className, type = 'button', ...props }: ButtonProps) => (
  <button type={type} className={cn('btn', variant === 'primary' && 'btn-primary', variant === 'quiet' && 'btn-quiet', variant === 'danger' && 'btn-danger', iconOnly && 'icon-button', className)} {...props} />
);
