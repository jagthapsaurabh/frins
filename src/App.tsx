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
import { AddLearnerPage } from './pages/admin/AddLearnerPage';
import { LearnerDossierPage } from './pages/admin/LearnerDossierPage';
import { CourseBuilderPage } from './pages/admin/CourseBuilderPage';
import { CoursesDirectory } from './pages/admin/CoursesDirectory';
import { MessagesPage } from './pages/MessagesPage';
import { NewNotificationPage } from './pages/admin/AdminNotifications';
import { NewStaffPage, StaffAccountPage } from './pages/admin/StaffPages';
import { DiscoveryQuestionPage, DiscoveryQuestionsPage } from './pages/admin/DiscoveryPages';
import { DiscoveryResultPage } from './pages/admin/DiscoveryResults';
import { TaskDetailPage } from './pages/admin/TaskDetailPage';
import { AssignTaskPage } from './pages/admin/AssignTaskPage';
import {
  CommunityListPage,
  CommunityMembersPage,
  CommunityRoomPage,
  NewCommunityPage
} from './pages/CommunityPages';
import { CoursePlayerPage } from './pages/learner/CoursePlayerPage';
import { LearnerTaskPage } from './pages/learner/LearnerTaskPage';
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
      <Route
        path="/dashboard/messages"
        element={
          <RequireLearner>
            <AppShell>
              <MessagesPage />
            </AppShell>
          </RequireLearner>
        }
      />
      <Route
        path="/dashboard/courses/:courseId"
        element={
          <RequireLearner>
            <AppShell>
              <CoursePlayerPage />
            </AppShell>
          </RequireLearner>
        }
      />
      <Route
        path="/dashboard/tasks/:taskId"
        element={
          <RequireLearner>
            <AppShell>
              <LearnerTaskPage />
            </AppShell>
          </RequireLearner>
        }
      />
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
      <Route
        path="/admin/learners/new"
        element={
          <RequireStaff roles={[...DASHBOARD_ROLES.admin]} loginPath="/admin/login">
            <AppShell>
              <AddLearnerPage />
            </AppShell>
          </RequireStaff>
        }
      />
      <Route
        path="/admin/learners/:learnerId"
        element={
          <RequireStaff roles={[...DASHBOARD_ROLES.admin]} loginPath="/admin/login">
            <AppShell>
              <LearnerDossierPage />
            </AppShell>
          </RequireStaff>
        }
      />
      <Route
        path="/admin/courses"
        element={
          <RequireStaff roles={[...DASHBOARD_ROLES.admin]} loginPath="/admin/login">
            <AppShell>
              <CoursesDirectory />
            </AppShell>
          </RequireStaff>
        }
      />
      <Route
        path="/admin/staff/new"
        element={
          <RequireStaff roles={[...DASHBOARD_ROLES.admin]} loginPath="/admin/login">
            <AppShell>
              <NewStaffPage />
            </AppShell>
          </RequireStaff>
        }
      />
      <Route
        path="/admin/staff/:userId"
        element={
          <RequireStaff roles={[...DASHBOARD_ROLES.admin]} loginPath="/admin/login">
            <AppShell>
              <StaffAccountPage />
            </AppShell>
          </RequireStaff>
        }
      />
      <Route
        path="/admin/discovery/questions"
        element={
          <RequireStaff roles={[...DASHBOARD_ROLES.admin]} loginPath="/admin/login">
            <AppShell>
              <DiscoveryQuestionsPage />
            </AppShell>
          </RequireStaff>
        }
      />
      <Route
        path="/admin/discovery/questions/:questionId"
        element={
          <RequireStaff roles={[...DASHBOARD_ROLES.admin]} loginPath="/admin/login">
            <AppShell>
              <DiscoveryQuestionPage />
            </AppShell>
          </RequireStaff>
        }
      />
      <Route
        path="/admin/discovery/results/:sessionId"
        element={
          <RequireStaff roles={[...DASHBOARD_ROLES.admin]} loginPath="/admin/login">
            <AppShell>
              <DiscoveryResultPage />
            </AppShell>
          </RequireStaff>
        }
      />
      <Route
        path="/admin/notifications/new"
        element={
          <RequireStaff roles={[...DASHBOARD_ROLES.admin]} loginPath="/admin/login">
            <AppShell>
              <NewNotificationPage />
            </AppShell>
          </RequireStaff>
        }
      />
      <Route
        path="/admin/tasks/new"
        element={
          <RequireStaff roles={[...DASHBOARD_ROLES.admin]} loginPath="/admin/login">
            <AppShell>
              <AssignTaskPage />
            </AppShell>
          </RequireStaff>
        }
      />
      <Route
        path="/admin/tasks/:taskId"
        element={
          <RequireStaff roles={[...DASHBOARD_ROLES.admin]} loginPath="/admin/login">
            <AppShell>
              <TaskDetailPage />
            </AppShell>
          </RequireStaff>
        }
      />
      <Route
        path="/admin/messages"
        element={
          <RequireStaff roles={[...DASHBOARD_ROLES.admin]} loginPath="/admin/login">
            <AppShell>
              <MessagesPage />
            </AppShell>
          </RequireStaff>
        }
      />
      <Route
        path="/admin/courses/new"
        element={
          <RequireStaff roles={[...DASHBOARD_ROLES.admin]} loginPath="/admin/login">
            <AppShell>
              <CourseBuilderPage />
            </AppShell>
          </RequireStaff>
        }
      />
      <Route
        path="/admin/courses/:courseId"
        element={
          <RequireStaff roles={[...DASHBOARD_ROLES.admin]} loginPath="/admin/login">
            <AppShell>
              <CourseBuilderPage />
            </AppShell>
          </RequireStaff>
        }
      />
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
        path="/guide/messages"
        element={
          <RequireStaff roles={[...DASHBOARD_ROLES.guide]} loginPath="/guide/login">
            <AppShell>
              <MessagesPage />
            </AppShell>
          </RequireStaff>
        }
      />
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


      {['/dashboard/communities', '/dashboard/communities/:communityId'].map((path) => (
        <Route
          key={path}
          path={path}
          element={
            <RequireLearner>
              <AppShell>{path.endsWith(':communityId') ? <CommunityRoomPage /> : <CommunityListPage />}</AppShell>
            </RequireLearner>
          }
        />
      ))}

      {['/admin/communities', '/admin/communities/new'].map((path) => (
        <Route
          key={path}
          path={path}
          element={
            <RequireStaff roles={[...DASHBOARD_ROLES.admin]} loginPath="/admin/login">
              <AppShell>{path.endsWith('/new') ? <NewCommunityPage /> : <CommunityListPage />}</AppShell>
            </RequireStaff>
          }
        />
      ))}
      <Route
        path="/admin/communities/:communityId"
        element={
          <RequireStaff roles={[...DASHBOARD_ROLES.admin]} loginPath="/admin/login">
            <AppShell>
              <CommunityRoomPage />
            </AppShell>
          </RequireStaff>
        }
      />
      <Route
        path="/admin/communities/:communityId/members"
        element={
          <RequireStaff roles={[...DASHBOARD_ROLES.admin]} loginPath="/admin/login">
            <AppShell>
              <CommunityMembersPage />
            </AppShell>
          </RequireStaff>
        }
      />

      {['/guide/communities', '/guide/communities/:communityId'].map((path) => (
        <Route
          key={path}
          path={path}
          element={
            <RequireStaff roles={[...DASHBOARD_ROLES.guide]} loginPath="/guide/login">
              <AppShell>{path.endsWith(':communityId') ? <CommunityRoomPage /> : <CommunityListPage />}</AppShell>
            </RequireStaff>
          }
        />
      ))}

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
