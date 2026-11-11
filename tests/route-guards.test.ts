import { describe, it, expect } from 'vitest';
import { decideDashboardAccess, DASHBOARD_ROLES, homeRouteForRole } from '../src/auth/guard.js';

describe('FRINS dashboard route guards', () => {
  it('FRI-AUTH-004: Nobody reaches a dashboard without a session', () => {
    expect(decideDashboardAccess(null, DASHBOARD_ROLES.learner)).toBe('REDIRECT_TO_SIGN_IN');
    expect(decideDashboardAccess(undefined, DASHBOARD_ROLES.admin)).toBe('REDIRECT_TO_SIGN_IN');
    expect(decideDashboardAccess({ role: null }, DASHBOARD_ROLES.guide)).toBe('REDIRECT_TO_SIGN_IN');
  });

  it('FRI-AUTH-005: Each role only opens its own dashboard', () => {
    expect(decideDashboardAccess({ role: 'LEARNER' }, DASHBOARD_ROLES.learner)).toBe('ALLOW');
    expect(decideDashboardAccess({ role: 'ADMIN' }, DASHBOARD_ROLES.admin)).toBe('ALLOW');
    expect(decideDashboardAccess({ role: 'CURRICULUM_OWNER' }, DASHBOARD_ROLES.admin)).toBe('ALLOW');
    expect(decideDashboardAccess({ role: 'GUIDE' }, DASHBOARD_ROLES.guide)).toBe('ALLOW');

    expect(decideDashboardAccess({ role: 'LEARNER' }, DASHBOARD_ROLES.admin)).toBe('REDIRECT_TO_SIGN_IN');
    expect(decideDashboardAccess({ role: 'LEARNER' }, DASHBOARD_ROLES.guide)).toBe('REDIRECT_TO_SIGN_IN');
    expect(decideDashboardAccess({ role: 'GUIDE' }, DASHBOARD_ROLES.admin)).toBe('REDIRECT_TO_SIGN_IN');
    expect(decideDashboardAccess({ role: 'ADMIN' }, DASHBOARD_ROLES.learner)).toBe('REDIRECT_TO_SIGN_IN');
    expect(decideDashboardAccess({ role: 'GUIDE' }, DASHBOARD_ROLES.aiEngine)).toBe('REDIRECT_TO_SIGN_IN');
  });

  it('FRI-AUTH-006: Sign-in sends each role to the matching dashboard', () => {
    expect(homeRouteForRole('LEARNER')).toBe('/dashboard');
    expect(homeRouteForRole('GUIDE')).toBe('/guide');
    expect(homeRouteForRole('ADMIN')).toBe('/admin');
    expect(homeRouteForRole('CURRICULUM_OWNER')).toBe('/admin');
    expect(homeRouteForRole(null)).toBe('/dashboard');
  });
});
