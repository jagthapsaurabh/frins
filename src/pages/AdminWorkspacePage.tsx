import React from 'react';
import { Navigate, useParams } from 'react-router-dom';
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
import { DiscoveryQuestionsPage } from './admin/DiscoveryPages';
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

  const hasAdminAccess = user?.role === 'ADMIN' || user?.role === 'CURRICULUM_OWNER';

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
      {activeTab === 'discovery' && <DiscoveryQuestionsPage />}
      {activeTab === 'courses' && <Navigate to="/admin/courses" replace />}
      {activeTab === 'communities' && <Navigate to="/admin/communities" replace />}
      {activeTab === 'messages' && <Navigate to="/admin/messages" replace />}
    </div>
  );
};
