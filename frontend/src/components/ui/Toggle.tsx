import type { InputHTMLAttributes } from 'react';

interface ToggleProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> { label: string; }
export const Toggle = ({ label, ...props }: ToggleProps) => <label className="switch-control"><input type="checkbox" {...props} /><span>{label}</span></label>;
