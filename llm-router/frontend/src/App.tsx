import { Suspense, lazy } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { EmptyState } from './components/ui/EmptyState';
import { Button } from './components/ui/Button';
import { Skeleton } from './components/ui/Skeleton';
import { Compass } from 'lucide-react';

const ChatPage = lazy(() => import('./pages/Chat').then((module) => ({ default: module.ChatPage })));
const DashboardPage = lazy(() => import('./pages/Dashboard').then((module) => ({ default: module.DashboardPage })));
const BenchmarkPage = lazy(() => import('./pages/Benchmark').then((module) => ({ default: module.BenchmarkPage })));
const EvaluationPage = lazy(() => import('./pages/Evaluation').then((module) => ({ default: module.EvaluationPage })));
const SettingsPage = lazy(() => import('./pages/Settings').then((module) => ({ default: module.SettingsPage })));
const InsightsPage = lazy(() => import('./pages/Insights').then((module) => ({ default: module.InsightsPage })));
const PrivacyPage = lazy(() => import('./pages/Privacy').then((module) => ({ default: module.PrivacyPage })));
const TermsPage = lazy(() => import('./pages/Terms').then((module) => ({ default: module.TermsPage })));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const NotFound = () => {
  const navigate = useNavigate();
  return <EmptyState icon={<Compass size={19} />} title="This route does not exist" description="Head back to the chat workspace to continue." action={<Button variant="primary" onClick={() => navigate('/')}>Open chat</Button>} />;
};

const PageLoader = () => <div className="page-loader" role="status" aria-label="Loading page"><Skeleton height={28} width="32%" /><Skeleton height={14} width="54%" /><Skeleton className="loader-card" height={380} /></div>;

export const App = () => (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Suspense fallback={<PageLoader />}><ChatPage /></Suspense>} />
          <Route path="insights" element={<Suspense fallback={<PageLoader />}><InsightsPage /></Suspense>} />
          <Route path="dashboard" element={<Suspense fallback={<PageLoader />}><DashboardPage /></Suspense>} />
          <Route path="benchmark" element={<Suspense fallback={<PageLoader />}><BenchmarkPage /></Suspense>} />
          <Route path="evaluation" element={<Suspense fallback={<PageLoader />}><EvaluationPage /></Suspense>} />
          <Route path="settings" element={<Suspense fallback={<PageLoader />}><SettingsPage /></Suspense>} />
          <Route path="privacy" element={<Suspense fallback={<PageLoader />}><PrivacyPage /></Suspense>} />
          <Route path="terms" element={<Suspense fallback={<PageLoader />}><TermsPage /></Suspense>} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </QueryClientProvider>
);
