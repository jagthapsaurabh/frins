import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppShell } from './components/AppShell';
import { PublicWebsitePage } from './pages/PublicWebsitePage';
import { DiscoveryPage } from './pages/DiscoveryPage';
import { LearnerDashboardPage } from './pages/LearnerDashboardPage';
import { GuideWorkspacePage } from './pages/GuideWorkspacePage';
import { AIPipelinePage } from './pages/AIPipelinePage';
import { AdminWorkspacePage } from './pages/AdminWorkspacePage';
import { SignInPage } from './pages/SignInPage';
import { StaffSignInPage } from './pages/StaffSignInPage';
import { decideDashboardAccess, DASHBOARD_ROLES } from './auth/guard';

const RouteLoader: React.FC = () => (
  <div className="route-loader" role="status" aria-live="polite">
    <span className="route-loader-dot" />
    <span>Loading...</span>
  </div>
);

/**
 * Learner-only guard for /dashboard.
 * Visitors who are not signed in are sent to the dedicated sign-in page at /login.
 */
const RequireLearner: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <RouteLoader />;
  if (decideDashboardAccess(user, DASHBOARD_ROLES.learner) !== 'ALLOW') {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
};

/** Staff-only guard. Anyone else lands on that console's own sign-in page. */
const RequireStaff: React.FC<{ roles: string[]; loginPath: string; children: React.ReactNode }> = ({
  roles,
  loginPath,
  children
}) => {
  const { user, loading } = useAuth();
  if (loading) return <RouteLoader />;
  if (decideDashboardAccess(user, roles) !== 'ALLOW') return <Navigate to={loginPath} replace />;
  return <>{children}</>;
};

export const EcosystemShell: React.FC = () => {
  const navigate = useNavigate();
  const openLogin = () => navigate('/login');

  return (
    <Routes>
      {/* Public website: learner-facing only */}
      <Route path="/" element={<PublicWebsitePage onOpenSignIn={openLogin} />} />
      <Route path="/why-frins" element={<PublicWebsitePage onOpenSignIn={openLogin} />} />
      <Route path="/how-it-works" element={<PublicWebsitePage onOpenSignIn={openLogin} />} />
      <Route path="/tracks" element={<PublicWebsitePage onOpenSignIn={openLogin} />} />
      <Route path="/discovery" element={<DiscoveryPage onOpenSignIn={openLogin} />} />

      {/* Learner sign-in + dashboard */}
      <Route path="/login" element={<SignInPage />} />
      {['/dashboard', '/dashboard/:section'].map((path) => (
        <Route
          key={path}
          path={path}
          element={
            <RequireLearner>
              <AppShell>
                <LearnerDashboardPage />
              </AppShell>
            </RequireLearner>
          }
        />
      ))}
      <Route path="/learner" element={<Navigate to="/dashboard" replace />} />
      <Route path="/prototype" element={<Navigate to="/dashboard" replace />} />

      {/* Staff sign-in pages (not linked from the public website) */}
      <Route
        path="/admin/login"
        element={
          <StaffSignInPage
            consoleName="Admin Console"
            allowedRoles={['ADMIN', 'CURRICULUM_OWNER']}
            destination="/admin"
          />
        }
      />
      <Route
        path="/guide/login"
        element={
          <StaffSignInPage consoleName="Guide Console" allowedRoles={['GUIDE']} destination="/guide" />
        }
      />
      <Route
        path="/ai-pipeline/login"
        element={
          <StaffSignInPage consoleName="AI Engine" allowedRoles={['ADMIN']} destination="/ai-pipeline" />
        }
      />

      {/* Staff consoles */}
      {['/admin', '/admin/:section'].map((path) => (
        <Route
          key={path}
          path={path}
          element={
            <RequireStaff roles={[...DASHBOARD_ROLES.admin]} loginPath="/admin/login">
              <AppShell>
                <AdminWorkspacePage />
              </AppShell>
            </RequireStaff>
          }
        />
      ))}
      <Route
        path="/guide"
        element={
          <RequireStaff roles={[...DASHBOARD_ROLES.guide]} loginPath="/guide/login">
            <AppShell>
              <GuideWorkspacePage />
            </AppShell>
          </RequireStaff>
        }
      />
      <Route
        path="/ai-pipeline"
        element={
          <RequireStaff roles={[...DASHBOARD_ROLES.aiEngine]} loginPath="/ai-pipeline/login">
            <AppShell>
              <AIPipelinePage />
            </AppShell>
          </RequireStaff>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export const App: React.FC = () => (
  <BrowserRouter>
    <AuthProvider>
      <EcosystemShell />
    </AuthProvider>
  </BrowserRouter>
);

export default App;
