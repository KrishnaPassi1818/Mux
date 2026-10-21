import { AlertCircle } from 'lucide-react';

export const ErrorBanner = ({ title = 'Something went wrong', message, requestId }: { title?: string; message: string; requestId?: string }) => (
  <div className="error-banner" role="alert"><AlertCircle size={17} aria-hidden="true" /><div><strong>{title}</strong><p>{message}{requestId ? ` Request ID: ${requestId}` : ''}</p></div></div>
);
