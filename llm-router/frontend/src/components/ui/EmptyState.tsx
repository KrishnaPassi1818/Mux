import type { ReactNode } from 'react';

export const EmptyState = ({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) => (
  <div className="empty-state"><div className="empty-icon" aria-hidden="true">{icon}</div><h3 className="empty-title">{title}</h3><p className="empty-description">{description}</p>{action}</div>
);
