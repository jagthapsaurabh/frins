/**
 * Dashboard access rules.
 *
 * A dashboard is only rendered when the visitor has a verified session whose role
 * is allowed on that dashboard. Everything else is sent to the sign-in page.
 * Keeping this in one small function means the rule can be unit tested.
 */
export type GuardDecision = 'ALLOW' | 'REDIRECT_TO_SIGN_IN';

export interface SessionUser {
  role?: string | null;
}

export function decideDashboardAccess(
  user: SessionUser | null | undefined,
  allowedRoles: readonly string[]
): GuardDecision {
  if (!user) return 'REDIRECT_TO_SIGN_IN';
  if (!user.role) return 'REDIRECT_TO_SIGN_IN';
  return allowedRoles.includes(user.role) ? 'ALLOW' : 'REDIRECT_TO_SIGN_IN';
}

export const DASHBOARD_ROLES = {
  learner: ['LEARNER'] as const,
  admin: ['ADMIN', 'CURRICULUM_OWNER'] as const,
  guide: ['GUIDE'] as const,
  aiEngine: ['ADMIN'] as const
};

/** Where a signed-in user belongs after signing in. */
export const homeRouteForRole = (role?: string | null): string => {
  if (role === 'ADMIN' || role === 'CURRICULUM_OWNER') return '/admin';
  if (role === 'GUIDE') return '/guide';
  return '/dashboard';
};
