import React from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { StaffSignInGate } from '../components/StaffSignInGate';
import { AdminOverview } from './admin/AdminOverview';
import { LearnersDirectory } from './admin/LearnersDirectory';
import { TasksDirectory } from './admin/TasksDirectory';
import { LearnerProgress } from './admin/LearnerProgress';
import { StaffDirectory } from './admin/StaffPages';
import { LeadsDirectory } from './admin/LeadsDirectory';
import { BookingsDirectory } from './admin/BookingsDirectory';
import { SettingsPage } from './admin/SettingsPage';
import { AdminNotifications } from './admin/AdminNotifications';
import { DiscoveryResultsPage } from './admin/DiscoveryResults';
import { ADMIN_SECTIONS, adminKeyFromPath, type AdminSectionKey } from './adminSections';

/**
 * The admin console is one shell with one set of screens. Each screen owns its
 * own data, so this file only decides which one to show for the URL.
 */
export const AdminWorkspacePage: React.FC = () => {
  const { user } = useAuth();
  const params = useParams<{ section?: string }>();

  const activeTab: AdminSectionKey = params.section
    ? adminKeyFromPath(`/admin/${params.section}`)
    : 'overview';

  const known = !params.section || ADMIN_SECTIONS.some((section) => section.key === params.section);

  const scopedGuide = user?.role === 'GUIDE' && (user.permissions?.length || 0) > 0;
  const hasAdminAccess = user?.role === 'ADMIN' || user?.role === 'CURRICULUM_OWNER' || scopedGuide;

  if (!hasAdminAccess) {
    return (
      <StaffSignInGate
        consoleName="Admin Console"
        allowedRoles={['ADMIN', 'CURRICULUM_OWNER']}
        currentRole={user?.role}
      />
    );
  }

  if (!known) {
    return <Navigate to="/admin" replace />;
  }

  // A staff account can be given a few sections and no more. The server enforces
  // the same list, so this screen only has to explain the stop politely.
  const permissions = user?.permissions && user.permissions.length ? user.permissions : null;
  const allowed = !permissions || permissions.includes('*') || permissions.includes(activeTab);
  const firstAllowed = ADMIN_SECTIONS.find((section) => permissions?.includes(section.key));

  /* A person should never open the console on a wall. A guide goes to their own
     workspace; anyone else goes to the first tab their role opens. The wall is
     still there for a link they follow by hand. */
  if (!allowed && !params.section) {
    if (user?.role === 'GUIDE') return <Navigate to="/guide" replace />;
    if (firstAllowed) return <Navigate to={firstAllowed.path} replace />;
  }

  if (!allowed) {
    return (
      <div className="admin-body">
        <div className="page-head">
          <div>
            <p className="micro-tag">Staff access</p>
            <h1>This section is not part of your access.</h1>
            <p>
              Your account is set up for {permissions!.length} section{permissions!.length === 1 ? '' : 's'} of the
              console. Ask an admin if you need this one opened up.
            </p>
          </div>
          {firstAllowed && <Link to={firstAllowed.path}>Go to {firstAllowed.label}</Link>}
        </div>
      </div>
    );
  }

  return (
    <div className="admin-body">
      {activeTab === 'overview' && <AdminOverview />}
      {activeTab === 'learners' && <LearnersDirectory />}
      {activeTab === 'tasks' && <TasksDirectory />}
      {activeTab === 'progress' && <LearnerProgress />}
      {activeTab === 'staff' && <StaffDirectory />}
      {activeTab === 'leads' && <LeadsDirectory />}
      {activeTab === 'bookings' && <BookingsDirectory />}
      {activeTab === 'settings' && <SettingsPage />}
      {activeTab === 'notifications' && <AdminNotifications />}
      {activeTab === 'discovery' && <DiscoveryResultsPage />}
      {activeTab === 'courses' && <Navigate to="/admin/courses" replace />}
      {activeTab === 'video' && <Navigate to="/admin/video" replace />}
      {activeTab === 'communities' && <Navigate to="/admin/communities" replace />}
      {activeTab === 'messages' && <Navigate to="/admin/messages" replace />}
    </div>
  );
};
