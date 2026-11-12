import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, KeyRound, Plus, Search, ShieldCheck, UserRound, Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Pager } from '../../components/Pager';
import { usePagedList } from '../../hooks/usePagedList';

const ROLE_LABEL: Record<string, string> = {
  LEARNER: 'Student',
  GUIDE: 'Guide',
  ADMIN: 'Administrator',
  CURRICULUM_OWNER: 'Curriculum owner'
};

const initialsOf = (name?: string) =>
  (name || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

/** Directory of every account: staff and learners, filters on the left of the table. */
export const StaffDirectory: React.FC = () => {
  const { authFetch, user } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('ALL');
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [q, role]);

  const list = usePagedList<any>(authFetch, '/api/admin/users', { q, role, page, limit: 20 });

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="page-eyebrow">People</span>
          <h1>Staff &amp; access</h1>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn btn-primary" onClick={() => navigate('/admin/staff/new')}>
            <Plus size={14} /> New account
          </button>
        </div>
      </div>

      {list.error && <div className="governance-alert danger">{list.error}</div>}

      <div className="toolbar">
        <div className="search-field">
          <Search size={14} />
          <input
            className="form-input"
            placeholder="Search name or email"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search accounts"
          />
        </div>
        <select
          className="form-select"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          aria-label="Filter by role"
          style={{ width: 'auto' }}
        >
          <option value="ALL">Every role</option>
          <option value="LEARNER">Students</option>
          <option value="GUIDE">Guides</option>
          <option value="ADMIN">Admins</option>
          <option value="CURRICULUM_OWNER">Curriculum owners</option>
        </select>
        <span className="toolbar-meta">{list.total} accounts</span>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th style={{ width: 110 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.rows.map((account) => (
              <tr key={account.id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span className="pick-avatar">{initialsOf(account.name)}</span>
                    <span>
                      <span className="row-title">{account.name}</span>
                      {account.id === user?.id && <span className="row-sub">You</span>}
                    </span>
                  </div>
                </td>
                <td className="row-sub">{account.email}</td>
                <td>{ROLE_LABEL[account.role] || account.role}</td>
                <td>
                  <span className={`status-pill ${account.account_status === 'ACTIVE' ? 'approved' : 'danger'}`}>
                    {account.account_status === 'ACTIVE' ? 'Active' : 'Suspended'}
                  </span>
                </td>
                <td>
                  <div className="table-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => navigate(`/admin/staff/${account.id}`)}
                    >
                      <UserRound size={13} /> Open
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!list.loading && list.rows.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <p className="section-note" style={{ padding: '8px 0' }}>No account matches that search.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pager page={list.page} pages={list.pages} total={list.total} limit={20} onChange={setPage} noun="accounts" />
    </div>
  );
};

/** Add a staff or learner account. Its own route, so the list stays a list. */
export const NewStaffPage: React.FC = () => {
  const { authFetch } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('GUIDE');
  const [track, setTrack] = useState('trader');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ password: string | null; email: string; name: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await authFetch('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({ name, email, role, track })
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok || !json.success) {
      setError(json.error || 'Could not create the account.');
      return;
    }
    setCreated({ password: json.temporaryPassword, email, name });
  };

  if (created) {
    return (
      <div>
        <div className="page-head">
          <div>
            <span className="page-eyebrow">Account created</span>
            <h1>{created.name}</h1>
          </div>
        </div>

        <section className="panel-card" style={{ maxWidth: 620 }}>
          <div className="panel-head">
            <div>
              <h2>Temporary password</h2>
              <p>Shown once. Send it to {created.email}, and ask them to change it after signing in.</p>
            </div>
          </div>
          <div className="temp-password">{created.password || 'Set by you at creation'}</div>
          <div className="page-head-actions" style={{ marginTop: 16 }}>
            <button type="button" className="btn btn-secondary" onClick={() => navigate('/admin/staff')}>
              Back to accounts
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div>
      <button type="button" className="back-link" onClick={() => navigate('/admin/staff')}>
        <ArrowLeft size={14} /> Staff &amp; access
      </button>

      <div className="page-head">
        <div>
          <span className="page-eyebrow">New account</span>
          <h1>Create an account</h1>
        </div>
      </div>

      {error && <div className="governance-alert danger">{error}</div>}

      <form onSubmit={submit} className="form-layout">
        <section className="panel-card">
          <div className="form-group">
            <label className="form-label" htmlFor="staff-name">Full name</label>
            <input
              id="staff-name"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ananya Deshmukh"
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="staff-email">Email</label>
            <input
              id="staff-email"
              className="form-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. ananya@frins.in"
              required
            />
          </div>
          <div className="form-row-2">
            <div className="form-group">
              <label className="form-label" htmlFor="staff-role">Role</label>
              <select id="staff-role" className="form-select" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="GUIDE">Guide</option>
                <option value="CURRICULUM_OWNER">Curriculum owner</option>
                <option value="ADMIN">Administrator</option>
                <option value="LEARNER">Student</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="staff-track">Track</label>
              <select id="staff-track" className="form-select" value={track} onChange={(e) => setTrack(e.target.value)}>
                <option value="student_concepts">Student concepts</option>
                <option value="strategy_learner">Strategy learner</option>
                <option value="trader">Trader</option>
                <option value="investor">Investor</option>
                <option value="both">All-round</option>
              </select>
            </div>
          </div>
          <p className="form-hint">
            A temporary password is generated and shown once. Nobody can log in with a guessable default.
          </p>
        </section>

        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/admin/staff')}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </div>
      </form>
    </div>
  );
};

/** One account: role, status, password. Every action here asks first. */
export const StaffAccountPage: React.FC = () => {
  const { userId = '' } = useParams();
  const { authFetch, user } = useAuth();
  const navigate = useNavigate();

  const [account, setAccount] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [role, setRole] = useState('');
  const [confirm, setConfirm] = useState<'role' | 'status' | 'password' | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await authFetch(`/api/admin/users/${userId}`);
    const json = await res.json();
    if (!res.ok || !json.success) {
      setError(json.error || 'That account does not exist.');
    } else {
      setAccount(json.account);
      setRole(json.account.role);
      setError(null);
    }
    setLoading(false);
  }, [authFetch, userId]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (action: 'role' | 'status' | 'password') => {
    if (!account) return;
    setBusy(true);
    setBanner(null);
    setError(null);
    try {
      if (action === 'role') {
        const res = await authFetch(`/api/admin/users/${account.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ role })
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'Could not change the role.');
        setBanner(`Role set to ${ROLE_LABEL[role] || role}.`);
        load();
      }
      if (action === 'status') {
        const next = account.account_status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
        const res = await authFetch(`/api/admin/users/${account.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ accountStatus: next })
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'Could not change the status.');
        setBanner(next === 'ACTIVE' ? 'Account activated.' : 'Account suspended.');
        load();
      }
      if (action === 'password') {
        const res = await authFetch(`/api/admin/users/${account.id}/reset-password`, { method: 'POST' });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'Could not reset the password.');
        setBanner(`New temporary password: ${json.temporaryPassword}`);
      }
    } catch (err: any) {
      setError(err?.message || 'That action failed.');
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  if (loading) return <p className="section-note">Loading the account.</p>;
  if (!account) return <div className="governance-alert danger">{error || 'Account not found.'}</div>;

  const isSelf = account.id === user?.id;

  return (
    <div>
      <button type="button" className="back-link" onClick={() => navigate('/admin/staff')}>
        <ArrowLeft size={14} /> Staff &amp; access
      </button>

      <div className="page-head">
        <div>
          <span className="page-eyebrow">Account</span>
          <h1>{account.name}</h1>
        </div>
        <div className="page-head-actions">
          <span className={`status-pill ${account.account_status === 'ACTIVE' ? 'approved' : 'danger'}`}>
            {account.account_status === 'ACTIVE' ? 'Active' : 'Suspended'}
          </span>
        </div>
      </div>

      {error && <div className="governance-alert danger">{error}</div>}
      {banner && <div className="governance-alert success">{banner}</div>}

      <div className="members-layout">
        <section className="panel-card">
          <div className="panel-head">
            <div>
              <h2>Identity</h2>
            </div>
          </div>
          <div className="list-stack">
            <div className="list-row">
              <span className="list-row-main">
                <span className="list-row-title">Email</span>
                <span className="list-row-sub">{account.email}</span>
              </span>
            </div>
            <div className="list-row">
              <span className="list-row-main">
                <span className="list-row-title">Role</span>
                <span className="list-row-sub">{ROLE_LABEL[account.role] || account.role}</span>
              </span>
            </div>
            <div className="list-row">
              <span className="list-row-main">
                <span className="list-row-title">Track</span>
                <span className="list-row-sub">{account.track || '—'}</span>
              </span>
            </div>
          </div>
        </section>

        <section className="panel-card">
          <div className="panel-head">
            <div>
              <h2>Access</h2>
              <p>Every change lands in the audit trail.</p>
            </div>
          </div>

          {isSelf ? (
            <p className="section-note">You cannot change your own role or suspend yourself.</p>
          ) : (
            <>
              <div className="form-group">
                <label className="form-label" htmlFor="account-role">Role</label>
                <select
                  id="account-role"
                  className="form-select"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                >
                  <option value="LEARNER">Student</option>
                  <option value="GUIDE">Guide</option>
                  <option value="CURRICULUM_OWNER">Curriculum owner</option>
                  <option value="ADMIN">Administrator</option>
                </select>
              </div>
              <div className="page-head-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || role === account.role}
                  onClick={() => setConfirm('role')}
                >
                  <ShieldCheck size={14} /> Save role
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => setConfirm('status')}
                >
                  {account.account_status === 'ACTIVE' ? 'Suspend account' : 'Activate account'}
                </button>
              </div>
            </>
          )}

          <div className="panel-head" style={{ marginTop: 20 }}>
            <div>
              <h2>Password</h2>
              <p>A reset gives them a fresh temporary password, shown once.</p>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => setConfirm('password')}
          >
            <KeyRound size={14} /> Reset password
          </button>
        </section>

        {account.role === 'LEARNER' && (
          <section className="panel-card">
            <div className="panel-head">
              <div>
                <h2>Learner file</h2>
              </div>
              <Link className="link-button" style={{ fontSize: 12 }} to={`/admin/learners/${account.id}`}>
                Open the file
              </Link>
            </div>
            <p className="section-note">
              Courses, tasks, calls and payments for this learner live on the learner file.
            </p>
          </section>
        )}
      </div>

      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm === 'role'
            ? 'Change this role?'
            : confirm === 'status'
              ? account.account_status === 'ACTIVE'
                ? 'Suspend this account?'
                : 'Activate this account?'
              : 'Reset the password?'
        }
        message={
          confirm === 'role'
            ? `Their console will change to ${ROLE_LABEL[role] || role} the next time they sign in.`
            : confirm === 'status'
              ? `They are ${account.account_status === 'ACTIVE' ? 'signed out of the console' : 'able to sign in again'} after this.`
              : 'The old password stops working straight away.'
        }
        confirmLabel={confirm === 'password' ? 'Reset' : 'Confirm'}
        variant={confirm === 'status' && account.account_status === 'ACTIVE' ? 'danger' : 'primary'}
        busy={busy}
        onConfirm={() => run(confirm || 'role')}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
};
