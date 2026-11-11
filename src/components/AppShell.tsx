import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  Sparkles,
  LogOut,
  ChevronDown,
  Repeat,
  Menu,
  X,
  BookOpenCheck,
  ArrowLeft,
  KeyRound,
  BookOpen,
  ClipboardList,
  TrendingUp,
  Sparkles as SparklesIcon
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ConfirmDialog } from './ConfirmDialog';
import { NotificationBell } from './NotificationBell';
import { ChangePasswordDialog } from './ChangePasswordDialog';
import { ADMIN_SECTIONS } from '../pages/adminSections';

export type ShellRole = 'LEARNER' | 'GUIDE' | 'ADMIN' | 'CURRICULUM_OWNER';

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  group?: string;
  exact?: boolean;
}

const ROLE_LABEL: Record<string, string> = {
  LEARNER: 'Student',
  GUIDE: 'Learning Guide',
  ADMIN: 'Administrator',
  CURRICULUM_OWNER: 'Curriculum Owner'
};

/**
 * Each role sees only the workspaces that belong to it.
 *
 * An admin gets one sidebar with every section of the console in it, grouped the
 * same way the page groups them. There is no second menu inside the page and no
 * "public website" entry, because the top bar already has a way back to the site.
 */
const navForRole = (role: string | undefined): NavItem[] => {
  const isAdmin = role === 'ADMIN' || role === 'CURRICULUM_OWNER';

  if (isAdmin) {
    return [
      ...ADMIN_SECTIONS.map((section) => ({
        path: section.path,
        label: section.label,
        icon: section.icon,
        group: section.group,
        exact: section.key === 'overview'
      })),
      // The AI engine is admin-only, so a curriculum owner does not get the link
      // to a page that would turn them away.
      ...(role === 'ADMIN'
        ? [{ path: '/ai-pipeline', label: 'AI Engine', icon: <SparklesIcon size={17} />, group: 'Tools' }]
        : [])
    ];
  }

  if (role === 'GUIDE') {
    return [
      { path: '/guide', label: 'Learner reviews', icon: <Users size={17} />, group: 'Workspace' }
    ];
  }

  return [
    { path: '/dashboard', label: 'Overview', icon: <LayoutDashboard size={17} />, group: 'Learning', exact: true },
    { path: '/dashboard/courses', label: 'My courses', icon: <BookOpen size={17} />, group: 'Learning' },
    { path: '/dashboard/tasks', label: 'Tasks & uploads', icon: <ClipboardList size={17} />, group: 'Learning' },
    { path: '/dashboard/progress', label: 'Progress', icon: <TrendingUp size={17} />, group: 'Learning' }
  ];
};

const groupsOf = (items: NavItem[]): string[] => {
  const seen: string[] = [];
  for (const item of items) {
    const group = item.group || 'Workspace';
    if (!seen.includes(group)) seen.push(group);
  }
  return seen;
};

const initialsOf = (name?: string) =>
  (name || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join('');

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    setSidebarOpen(false);
    setMenuOpen(false);
  }, [location.pathname]);

  const nav = navForRole(user?.role);
  const isActivePath = (item: NavItem) => {
    if (item.path === '/dashboard' && (location.pathname === '/prototype' || location.pathname === '/learner')) {
      return true;
    }
    if (item.exact) return location.pathname === item.path;
    return location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);
  };
  const current = nav.find(isActivePath) ||
    (location.pathname === '/prototype' ? nav[0] : undefined);
  const homeLabel = user?.role === 'ADMIN' || user?.role === 'CURRICULUM_OWNER'
    ? 'Admin console'
    : user?.role === 'GUIDE'
      ? 'Guide'
      : 'My learning';

  return (
    <div className="app-shell">
      {/* ---------- Sidebar ---------- */}
      <aside className={`app-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="app-sidebar-brand">
          <button
            type="button"
            className="app-brand-button"
            onClick={() => navigate(nav[0]?.path || '/')}
            aria-label="FRINS home"
          >
            <span className="app-brand-mark" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6">
                <path d="M4 6h16M4 12h10M4 18h6" strokeLinecap="round" />
                <circle cx="18" cy="15" r="3" />
              </svg>
            </span>
            <span className="app-brand-text">
              <strong>FRINS</strong>
              <small>Learning Platform</small>
            </span>
          </button>
          <button
            type="button"
            className="app-sidebar-close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="app-sidebar-nav" aria-label="Dashboard navigation">
          {groupsOf(nav).map((group) => (
            <div key={group} className="app-nav-group">
              <span className="app-nav-section">{group}</span>
              {nav
                .filter((item) => (item.group || 'Workspace') === group)
                .map((item) => (
                  <button
                    key={item.path}
                    type="button"
                    className={`app-nav-item ${isActivePath(item) ? 'active' : ''}`}
                    aria-current={isActivePath(item) ? 'page' : undefined}
                    onClick={() => navigate(item.path)}
                  >
                    <span className="app-nav-icon">{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                ))}
            </div>
          ))}
        </nav>

        <div className="app-sidebar-footer">
          {user?.role === 'LEARNER' && (
          <div className="app-sidebar-card">
            <BookOpenCheck size={16} />
            <div>
              <strong>Need a hand?</strong>
              <p>Book a 1-on-1 call with your learning team.</p>
              <button type="button" onClick={() => navigate('/')}>
                Book a Call
              </button>
            </div>
          </div>
          )}
          <button type="button" className="app-nav-item subtle" onClick={() => setSignOutOpen(true)}>
            <span className="app-nav-icon">
              <LogOut size={17} />
            </span>
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {sidebarOpen && <div className="app-sidebar-scrim" onClick={() => setSidebarOpen(false)} />}

      {/* ---------- Main column ---------- */}
      <div className="app-main">
        <header className="app-topbar">
          <div className="app-topbar-left">
            <button
              type="button"
              className="app-icon-button mobile-only"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={19} />
            </button>
            <div className="app-breadcrumb">
              <span>{homeLabel}</span>
              <span className="app-breadcrumb-sep">/</span>
              <strong>{current?.label || 'Workspace'}</strong>
            </div>
          </div>

          <div className="app-topbar-right">
            <NotificationBell />

            <div className="app-account" ref={menuRef}>
              <button
                type="button"
                className="app-account-trigger"
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <span className="app-avatar">{initialsOf(user?.name)}</span>
                <span className="app-account-meta">
                  <strong>{user?.name || 'Guest'}</strong>
                  <small>{ROLE_LABEL[user?.role || ''] || 'Visitor'}</small>
                </span>
                <ChevronDown size={15} className={`app-chevron ${menuOpen ? 'up' : ''}`} />
              </button>

              {menuOpen && (
                <div className="app-menu" role="menu">
                  <div className="app-menu-identity">
                    <span className="app-avatar lg">{initialsOf(user?.name)}</span>
                    <div>
                      <strong>{user?.name}</strong>
                      <small>{user?.email}</small>
                      <span className="app-role-chip">{ROLE_LABEL[user?.role || ''] || 'Visitor'}</span>
                    </div>
                  </div>

                  {user?.role === 'LEARNER' && (
                    <button type="button" className="app-menu-item" onClick={() => navigate('/dashboard')}>
                      <LayoutDashboard size={16} /> My learning dashboard
                    </button>
                  )}

                  <button
                    type="button"
                    className="app-menu-item website-link"
                    onClick={() => navigate('/')}
                  >
                    <ArrowLeft size={16} /> View public website
                  </button>

                  <div className="app-menu-divider" />
                  <button
                    type="button"
                    className="app-menu-item"
                    onClick={() => {
                      setMenuOpen(false);
                      setPasswordOpen(true);
                    }}
                  >
                    <KeyRound size={16} /> Update password
                  </button>
                  <button
                    type="button"
                    className="app-menu-item"
                    onClick={() => {
                      setMenuOpen(false);
                      setSignOutOpen(true);
                    }}
                  >
                    <Repeat size={16} /> Switch account
                  </button>
                  <p className="app-menu-hint">You will be signed out so you can sign in with another account.</p>

                  <div className="app-menu-divider" />
                  <button
                    type="button"
                    className="app-menu-item danger"
                    onClick={() => {
                      setMenuOpen(false);
                      setSignOutOpen(true);
                    }}
                  >
                    <LogOut size={16} /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="app-content">{children}</main>
      </div>

      <ChangePasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} />

      <ConfirmDialog
        open={signOutOpen}
        title="Sign out of FRINS?"
        message={
          <>
            You are signed in as <strong>{user?.name}</strong>. You will need to enter your credentials again to
            return to your dashboard.
          </>
        }
        confirmLabel="Sign out"
        cancelLabel="Stay signed in"
        variant="primary"
        onCancel={() => setSignOutOpen(false)}
        onConfirm={async () => {
          await logout();
          setSignOutOpen(false);
          navigate('/');
        }}
      />
    </div>
  );
};
