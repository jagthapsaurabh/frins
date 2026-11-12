import React from 'react';
import {
  Users,
  CalendarCheck,
  ClipboardList,
  BookOpen,
  GraduationCap,
  HelpCircle,
  LayoutDashboard,
  UserCog,
  Contact,
  TrendingUp,
  BellRing,
  Settings as SettingsIcon,
  MessageSquare,
  UsersRound
} from 'lucide-react';

export type AdminSectionKey =
  | 'overview'
  | 'tasks'
  | 'courses'
  | 'learners'
  | 'progress'
  | 'staff'
  | 'leads'
  | 'bookings'
  | 'notifications'
  | 'messages'
  | 'communities'
  | 'discovery'
  | 'settings';

export interface AdminSection {
  key: AdminSectionKey;
  label: string;
  hint: string;
  icon: React.ReactNode;
  group: 'Work' | 'People' | 'Growth' | 'Setup';
  /** Route for the section. Overview lives at /admin itself. */
  path: string;
}

/**
 * The single source of truth for the admin navigation. The app sidebar renders
 * it, and the admin page decides which section to show from the same list, so
 * a section can never exist in one place and be missing in the other.
 */
export const ADMIN_SECTIONS: AdminSection[] = [
  { key: 'overview', label: 'Overview', hint: 'Today at a glance', icon: <LayoutDashboard size={17} />, group: 'Work', path: '/admin' },
  { key: 'tasks', label: 'Tasks', hint: 'Uploads, AI pre-check, chat', icon: <ClipboardList size={17} />, group: 'Work', path: '/admin/tasks' },
  { key: 'messages', label: 'Messages', hint: 'Talk to a learner', icon: <MessageSquare size={17} />, group: 'Work', path: '/admin/messages' },
  { key: 'courses', label: 'Courses', hint: 'Build and publish courses', icon: <BookOpen size={17} />, group: 'Work', path: '/admin/courses' },
  { key: 'communities', label: 'Communities', hint: 'Groups with a shared feed', icon: <UsersRound size={17} />, group: 'Work', path: '/admin/communities' },
  { key: 'learners', label: 'Learners', hint: 'Roster, plans, assessments', icon: <GraduationCap size={17} />, group: 'People', path: '/admin/learners' },
  { key: 'progress', label: 'Learner progress', hint: 'Courses, tasks, uploads', icon: <TrendingUp size={17} />, group: 'People', path: '/admin/progress' },
  { key: 'staff', label: 'Staff & access', hint: 'Roles, status, passwords', icon: <UserCog size={17} />, group: 'People', path: '/admin/staff' },
  { key: 'leads', label: 'Leads', hint: 'Website form inbox', icon: <Contact size={17} />, group: 'Growth', path: '/admin/leads' },
  { key: 'bookings', label: 'Bookings', hint: 'Calls with the team', icon: <CalendarCheck size={17} />, group: 'Growth', path: '/admin/bookings' },
  { key: 'notifications', label: 'Notifications', hint: 'Send notices', icon: <BellRing size={17} />, group: 'Growth', path: '/admin/notifications' },
  { key: 'discovery', label: 'Discovery', hint: 'Questions and answers', icon: <HelpCircle size={17} />, group: 'Setup', path: '/admin/discovery' },
  { key: 'settings', label: 'Settings', hint: 'Password, rubrics, audit', icon: <SettingsIcon size={17} />, group: 'Setup', path: '/admin/settings' }
];

export const ADMIN_GROUPS = ['Work', 'People', 'Growth', 'Setup'] as const;

export const findAdminSection = (key: string | undefined): AdminSection =>
  ADMIN_SECTIONS.find((section) => section.key === key) || ADMIN_SECTIONS[0];

/** Section key from a URL segment, so /admin/staff resolves to 'staff'. */
export const adminKeyFromPath = (pathname: string): AdminSectionKey => {
  const segment = pathname.replace(/^\/admin\/?/, '').split('/')[0];
  const match = ADMIN_SECTIONS.find((section) => section.key === segment);
  return match ? match.key : 'overview';
};
