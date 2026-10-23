import type { ReactNode } from 'react';

export const Tooltip = ({ label, children }: { label: string; children: ReactNode }) => <span className="tooltip-wrap"><span aria-hidden="true">{children}</span><span role="tooltip" className="tooltip-content">{label}</span></span>;
