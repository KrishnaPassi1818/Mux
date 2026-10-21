import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLElement> { children: ReactNode; }
export const Card = ({ children, className = '', ...props }: CardProps) => <section className={`card ${className}`} {...props}>{children}</section>;
export const CardHeader = ({ children, className = '', ...props }: HTMLAttributes<HTMLElement> & { children: ReactNode }) => <header className={`card-header ${className}`} {...props}>{children}</header>;
export const CardBody = ({ children, className = '', ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) => <div className={`card-body ${className}`} {...props}>{children}</div>;
