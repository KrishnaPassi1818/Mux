export const Skeleton = ({ width = '100%', height = 16, className = '' }: { width?: number | string; height?: number | string; className?: string }) => (
  <div className={`skeleton ${className}`} aria-hidden="true" style={{ width, height }} />
);
