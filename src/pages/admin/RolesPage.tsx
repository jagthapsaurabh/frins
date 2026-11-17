import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Pencil, Plus, ShieldCheck, Trash2, Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { PageHead } from '../../components/console/ConsoleUI';
import { ADMIN_SECTIONS } from '../adminSections';

export interface NamedRole {
  id: string;
  name: string;
  description: string;
  baseRole: 'GUIDE' | 'CURRICULUM_OWNER' | 'ADMIN';
  sections: string[];
  /** Ships with the app. Its name and level are fixed, its tabs are not. */
  builtIn: boolean;
  defaults: { description: string; sections: string[] } | null;
  memberCount: number;
  created_at: string;
  updated_at: string;
}

const LEVEL_OPTIONS: Array<{ value: NamedRole['baseRole']; label: string; hint: string }> = [
  {
    value: 'GUIDE',
    label: 'Guide workspace',
    hint: 'Signs in to the guide area with their own learners. The tabs you tick appear above that work.'
  },
  {
    value: 'CURRICULUM_OWNER',
    label: 'Admin console',
    hint: 'Signs in to the admin console. Sees the tabs you tick and nothing else.'
  },
  {
    value: 'ADMIN',
    label: 'Admin console, full rights',
    hint: 'Like an administrator, limited to the tabs you tick. Use this only when someone needs admin-only screens.'
  }
];

const levelLabel = (value?: string) =>
  value === 'GUIDE' ? 'Guide workspace' : value === 'ADMIN' ? 'Full rights' : 'Admin console';

const sectionLabel = (key: string) =>
  key === '*' ? 'Every tab' : ADMIN_SECTIONS.find((section) => section.key === key)?.label || key;

const sectionSummary = (sections: string[]) => {
  if (sections.includes('*')) return 'Every tab, including any added later';
  if (!sections.length) return 'No tabs';
  return sections.map(sectionLabel).join(', ');
};

/** Tabs Accounts | Roles. Both live under Staff & access so the nav stays one list. */
export const StaffTabs: React.FC<{ active: 'accounts' | 'roles' }> = ({ active }) => {
  const { user } = useAuth();
  const canSeeRoles = user?.role === 'ADMIN' || user?.role === 'CURRICULUM_OWNER';

  return (
    <div className="staff-tabs" role="tablist" aria-label="Staff and access">
      <Link className={`staff-tab ${active === 'accounts' ? 'on' : ''}`} to="/admin/staff" role="tab">
        Accounts
      </Link>
      {canSeeRoles && (
        <Link className={`staff-tab ${active === 'roles' ? 'on' : ''}`} to="/admin/staff/roles" role="tab">
          Roles
        </Link>
      )}
    </div>
  );
};

/** Every named role, what it opens, and who holds it. */
export const RolesPage: React.FC = () => {
  const { authFetch, user } = useAuth();
  const navigate = useNavigate();
  const [roles, setRoles] = useState<NamedRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NamedRole | null>(null);
  const [deleting, setDeleting] = useState(false);

  const isAdmin = user?.role === 'ADMIN';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/admin/roles');
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || 'Could not load the roles.');
        return;
      }
      setRoles(json.rows || []);
      setError(null);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    load();
  }, [load]);

  const removeRole = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    setBanner(null);
    try {
      const res = await authFetch(`/api/admin/roles/${deleteTarget.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || 'Could not remove that role.');
        setDeleteTarget(null);
        return;
      }
      setBanner(`${deleteTarget.name} removed.`);
      setDeleteTarget(null);
      load();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <PageHead
        title="Staff & access"
        meta="Roles decide what a staff account can open"
        actions={
          isAdmin ? (
            <>
              <Link className="btn btn-secondary" to="/admin/staff">
                <Users size={14} /> Accounts
              </Link>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => navigate('/admin/staff/roles/new')}
              >
                <Plus size={14} /> New role
              </button>
            </>
          ) : undefined
        }
      />

      <StaffTabs active="roles" />

      {error && <div className="governance-alert danger">{error}</div>}
      {banner && (
        <div className="governance-alert success">
          <Check size={13} /> {banner}
        </div>
      )}

      <section className="panel-card">
        <div className="panel-head">
          <div>
            <h2>Roles</h2>
            <p>
              Every role an account can hold. The three shipped roles are here too, so their tabs can be
              changed or put back the way they came.
            </p>
          </div>
          <span className="panel-count">{roles.length}</span>
        </div>

        {loading ? (
          <p className="table-empty">Loading...</p>
        ) : roles.length === 0 ? (
          <div className="empty-state">
            <strong>No roles yet</strong>
            A role saves you ticking the same tabs for every new account. Create one, then pick it when you add
            someone.
          </div>
        ) : (
          <div className="role-list">
            {roles.map((role) => (
              <div className="role-row" key={role.id}>
                <div className="role-mark" aria-hidden="true">
                  <ShieldCheck size={15} />
                </div>
                <div className="role-main">
                  <strong>
                    {role.name}
                    {role.builtIn && <span className="role-builtin-tag">Built in</span>}
                  </strong>
                  <span className="role-meta">
                    {levelLabel(role.baseRole)}
                    {' · '}
                    {role.sections.includes('*')
                      ? 'every tab'
                      : `${role.sections.length} ${role.sections.length === 1 ? 'tab' : 'tabs'}`}
                    {' · '}
                    {role.memberCount === 0
                      ? 'nobody yet'
                      : `${role.memberCount} ${role.memberCount === 1 ? 'person' : 'people'}`}
                  </span>
                  <span className="role-tabs">{sectionSummary(role.sections)}</span>
                </div>
                {isAdmin && (
                  <div className="role-actions">
                    <Link className="btn btn-secondary btn-sm" to={`/admin/staff/roles/${role.id}`}>
                      <Pencil size={12} /> Edit
                    </Link>
                    {!role.builtIn && (
                      <button
                        type="button"
                        className="btn btn-icon"
                        aria-label={`Remove ${role.name}`}
                        onClick={() => setDeleteTarget(role)}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel-card role-note-card">
        <h3 className="role-note-title">How the shipped roles behave</h3>
        <p>
          Guide, Curriculum owner and Administrator arrive with the app. Their names and levels are fixed,
          because the rest of the product refers to them by those names. Their tabs are yours: tick or untick,
          and every account holding that role follows.
        </p>
        <p>
          A guide works from their own workspace. Tasks, Learners, Messages and Communities match the pages
          already there, so the sidebar lists them once. Ticking another tab adds that console page for them.
        </p>
        <p>
          Students are not staff, so the student dashboard is not a role here. New students get it when their
          account is created.
        </p>
      </section>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Remove this role?"
        message={
          deleteTarget
            ? deleteTarget.memberCount > 0
              ? `${deleteTarget.name} is held by ${deleteTarget.memberCount} ${
                  deleteTarget.memberCount === 1 ? 'account' : 'accounts'
                }. Move them to another role first.`
              : `${deleteTarget.name} will be removed. Nobody holds it, so nothing else changes.`
            : ''
        }
        confirmLabel="Remove"
        variant="danger"
        busy={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={removeRole}
      />
    </div>
  );
};

/** Create a role, or change one. The section grid is the same idea as the account page. */
export const RoleEditorPage: React.FC = () => {
  const { roleId } = useParams();
  const navigate = useNavigate();
  const { authFetch, user } = useAuth();
  const editing = Boolean(roleId);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [baseRole, setBaseRole] = useState<NamedRole['baseRole']>('GUIDE');
  const [sections, setSections] = useState<string[]>([]);
  const [members, setMembers] = useState(0);
  const [builtIn, setBuiltIn] = useState(false);
  const [defaults, setDefaults] = useState<NamedRole['defaults']>(null);
  const [resetting, setResetting] = useState(false);
  const [loading, setLoading] = useState(editing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const isAdmin = user?.role === 'ADMIN';

  useEffect(() => {
    if (!roleId) return;
    let alive = true;
    (async () => {
      try {
        const res = await authFetch('/api/admin/roles');
        const json = await res.json();
        const found: NamedRole | undefined = (json.rows || []).find((row: NamedRole) => row.id === roleId);
        if (!alive) return;
        if (!found) {
          setError('That role does not exist any more.');
        } else {
          setName(found.name);
          setDescription(found.description || '');
          setBaseRole(found.baseRole);
          setSections(found.sections);
          setMembers(found.memberCount);
          setBuiltIn(found.builtIn);
          setDefaults(found.defaults);
        }
      } catch {
        if (alive) setError('Could not reach the server.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [authFetch, roleId]);

  const toggle = (key: string) => {
    setSaved(null);
    setSections((list) =>
      list.includes('*')
        ? // Everything is on. Unticking one tab turns everything into that list minus the tab.
          ADMIN_SECTIONS.filter((section) => section.key !== key).map((section) => section.key)
        : list.includes(key)
          ? list.filter((entry) => entry !== key)
          : [...list, key]
    );
  };

  const everything = sections.includes('*') || sections.length === ADMIN_SECTIONS.length;

  /** Put a shipped role back to the tabs and note it came with. */
  const restoreDefaults = async () => {
    if (!roleId) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    setResetting(true);
    try {
      const res = await authFetch(`/api/admin/roles/${roleId}/reset`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || 'Could not reset the role.');
        return;
      }
      setSections(json.role.sections);
      setDescription(json.role.description);
      setSaved(`${json.role.name} is back to the tabs it came with.`);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
      setResetting(false);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(null);
    if (name.trim().length < 2) {
      setError('Give the role a name first.');
      return;
    }
    if (!sections.length) {
      setError('Tick at least one tab this role can open.');
      return;
    }
    setBusy(true);
    try {
      const res = await authFetch(editing ? `/api/admin/roles/${roleId}` : '/api/admin/roles', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify({ name: name.trim(), description: description.trim(), baseRole, sections })
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || 'Could not save the role.');
        return;
      }
      if (editing) {
        setSaved(`Saved. Anyone holding ${json.role.name} gets this access the next time they load the console.`);
        setMembers(json.role.memberCount);
      } else {
        navigate(`/admin/staff/roles/${json.role.id}`, { replace: true });
      }
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="governance-alert danger">
        Only a full administrator can create or change roles.
      </div>
    );
  }

  if (loading) return <p className="section-note">Loading the role.</p>;

  return (
    <div>
      <button type="button" className="back-link" onClick={() => navigate('/admin/staff/roles')}>
        <ArrowLeft size={14} /> Roles
      </button>

      <PageHead
        title={editing ? name || 'Role' : 'New role'}
        meta={
          editing
            ? `${members} ${members === 1 ? 'person holds' : 'people hold'} this role${
                builtIn ? ' · ships with the app' : ''
              }`
            : 'What this job can open'
        }
      />

      {error && <div className="governance-alert danger">{error}</div>}
      {saved && (
        <div className="governance-alert success">
          <Check size={13} /> {saved}
        </div>
      )}

      <form onSubmit={save} className="role-form">
        <div className="detail-grid">
          <div className="detail-main">
            <section className="panel-card">
              <div className="panel-head">
                <h2>Name and level</h2>
              </div>

              {builtIn && (
                <p className="role-locked-note">
                  This role ships with the app, so its name and level stay as they are. Its tabs and its note
                  are yours to change.
                </p>
              )}

              <div className="form-group">
                <label className="form-label" htmlFor="role-name">
                  Role name
                </label>
                <input
                  id="role-name"
                  className="form-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Content reviewer"
                  maxLength={60}
                  disabled={builtIn}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="role-note">
                  What it is for <span className="vs-optional">Optional</span>
                </label>
                <input
                  id="role-note"
                  className="form-input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Reviews course drafts and video drafts, nothing else"
                  maxLength={240}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <span className="form-label">Where this role signs in</span>
                <div className="level-choices">
                  {LEVEL_OPTIONS.map((option) => (
                    <label key={option.value} className={`level-choice ${baseRole === option.value ? 'on' : ''}`}>
                      <input
                        type="radio"
                        name="role-level"
                        value={option.value}
                        checked={baseRole === option.value}
                        onChange={() => setBaseRole(option.value)}
                        disabled={builtIn}
                      />
                      <span>
                        <strong>{option.label}</strong>
                        <span>{option.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </section>
          </div>

          <div className="detail-side">
            <section className="panel-card">
              <div className="panel-head">
                <div>
                  <h2>What it can open</h2>
                  <p>Tick the tabs this role needs. Nothing else appears in their sidebar.</p>
                </div>
              </div>

              <label className={`access-tile full ${everything ? 'on' : ''}`}>
                <input
                  type="checkbox"
                  checked={everything}
                  onChange={() =>
                    setSections(everything ? [] : ['*'])
                  }
                />
                <span className="access-tile-text">
                  <strong>Everything</strong>
                  <span>Every tab now, and any tab added later.</span>
                </span>
              </label>

              <div className="access-matrix-grid" style={{ marginTop: 8 }}>
                {ADMIN_SECTIONS.map((section) => {
                  const on = sections.includes('*') || sections.includes(section.key);
                  return (
                    <label key={section.key} className={`access-tile ${on ? 'on' : ''}`}>
                      <input type="checkbox" checked={on} onChange={() => toggle(section.key)} />
                      <span className="access-tile-icon">{section.icon}</span>
                      <span className="access-tile-text">
                        <strong>{section.label}</strong>
                        <span>{section.hint}</span>
                      </span>
                    </label>
                  );
                })}
              </div>

              {baseRole === 'GUIDE' && (
                <p className="role-guide-hint">
                  A guide works from their own workspace first. Tasks, Learners, Messages and Communities
                  already appear there, so ticking them adds no second copy to the sidebar.
                </p>
              )}

              <div className="access-matrix-actions">
                <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
                  {busy && !resetting ? 'Saving...' : editing ? 'Save the role' : 'Create the role'}
                </button>
                {builtIn && defaults && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={restoreDefaults}
                    disabled={busy}
                  >
                    {resetting ? 'Resetting...' : 'Put the tabs back'}
                  </button>
                )}
                <span className="section-note">
                  {sections.includes('*')
                    ? 'Everything, including sections added later.'
                    : sections.length
                      ? `${sections.length} ${sections.length === 1 ? 'tab' : 'tabs'} open.`
                      : 'Nothing ticked yet.'}
                </span>
              </div>
            </section>

            {editing && (
              <section className="panel-card role-note-card">
                <h3 className="role-note-title">Changing a role</h3>
                {builtIn ? (
                  <p>
                    {name} ships with the app, so its name and level stay put. Everyone holding it follows any
                    tab you tick or untick. If an edit does not feel right, put the tabs back and it returns to
                    the way it came.
                  </p>
                ) : (
                  <p>
                    Everyone holding this role gets the change. If you move it to another level, their account
                    level moves with it. Any personal tab list they had is cleared, so this role becomes their
                    whole access.
                  </p>
                )}
                <Link className="link-button" to="/admin/staff">
                  See who can sign in
                </Link>
              </section>
            )}
          </div>
        </div>
      </form>
    </div>
  );
};
