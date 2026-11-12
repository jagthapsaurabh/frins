import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Pager } from '../../components/Pager';
import { usePagedList } from '../../hooks/usePagedList';
import {
  FilterSelect,
  InlineSelect,
  PageHead,
  SearchBox,
  TableShell,
  Toolbar
} from '../../components/console/ConsoleUI';
import { formatDate } from '../../utils/dates';

const BOOKING_STATUSES = [
  { value: 'REQUESTED', label: 'Asked' },
  { value: 'NEW', label: 'New' },
  { value: 'DIRECT_CALL_BOOKED', label: 'Website' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'RESCHEDULED', label: 'Moved' },
  { value: 'COMPLETED', label: 'Done' },
  { value: 'NO_SHOW', label: 'No show' },
  { value: 'CANCELLED', label: 'Cancelled' }
];

/**
 * Calls people have asked for, from the dashboard and from the public site.
 * Changing the status or the owner saves straight away.
 */
export const BookingsDirectory: React.FC = () => {
  const { authFetch } = useAuth();

  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [source, setSource] = useState('ALL');
  const [page, setPage] = useState(1);
  const [staff, setStaff] = useState<any[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [status, source]);

  useEffect(() => {
    authFetch('/api/admin/users?role=GUIDE&limit=100')
      .then((res) => (res.ok ? res.json() : { rows: [] }))
      .then((json) => setStaff(json.rows || []))
      .catch(() => setStaff([]));
  }, [authFetch]);

  const list = usePagedList<any>(authFetch, '/api/admin/bookings', { q: query, status, source, page, limit: 20 });

  const patch = async (booking: any, body: Record<string, any>) => {
    const bookingId = booking.id;
    setSavingId(bookingId);
    setError(null);
    const res = await authFetch(`/api/admin/bookings/${bookingId}`, {
      method: 'PATCH',
      // The endpoint always writes a status, so send the current one with it.
      body: JSON.stringify({ status: booking.status, ...body })
    });
    const json = await res.json().catch(() => ({}));
    setSavingId(null);
    if (!res.ok || !json.success) {
      setError(json.error || 'Could not save that change.');
      return;
    }
    list.reload();
  };

  const requested = list.rows.filter((row) => row.status === 'REQUESTED' || row.status === 'NEW').length;

  return (
    <div>
      <PageHead
        title="Bookings"
        meta={
          list.total > 0
            ? `${list.total} ${list.total === 1 ? 'call' : 'calls'}${requested ? `, ${requested} waiting` : ''}`
            : undefined
        }
      />

      {error && <div className="governance-alert danger">{error}</div>}
      {list.error && <div className="governance-alert danger">{list.error}</div>}

      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder="Search name, email or topic" />
        <FilterSelect
          label="Filter by status"
          value={status}
          onChange={setStatus}
          options={[{ value: 'ALL', label: 'Every status' }, ...BOOKING_STATUSES]}
        />
        <FilterSelect
          label="Filter by source"
          value={source}
          onChange={setSource}
          options={[
            { value: 'ALL', label: 'Every source' },
            { value: 'LEARNER', label: 'From dashboard' },
            { value: 'PUBLIC', label: 'From website' }
          ]}
        />
      </Toolbar>

      <TableShell
        loading={list.loading}
        isEmpty={!list.loading && list.rows.length === 0}
        empty="No booking matches these filters."
        columns={[
          { label: 'Person' },
          { label: 'Source' },
          { label: 'Topic' },
          { label: 'Preferred slot' },
          { label: 'Owner', width: 160 },
          { label: 'Status', width: 150 }
        ]}
      >
        {list.rows.map((booking) => (
          <tr key={booking.id}>
            <td data-label="Person">
              <span className="row-title">{booking.participant_name}</span>
              <span className="row-sub">
                {booking.participant_email}
                {booking.participant_phone ? ` · ${booking.participant_phone}` : ''}
              </span>
            </td>
            <td data-label="Source">
              <span className={`status-pill ${booking.learner_id ? 'info' : ''}`}>
                {booking.learner_id ? 'Dashboard' : 'Website'}
              </span>
            </td>
            <td data-label="Topic" className="row-sub" style={{ maxWidth: 240 }}>
              {booking.topic || 'General call'}
            </td>
            <td data-label="Preferred slot" style={{ whiteSpace: 'nowrap' }}>
              <span className="row-title" style={{ fontWeight: 500 }}>
                {formatDate(booking.preferred_date)}
              </span>
              <span className="row-sub">{booking.preferred_time || 'Time to be set'}</span>
            </td>
            <td data-label="Owner">
              <select
                className="row-select"
                aria-label={`Owner for ${booking.participant_name}`}
                value={booking.staff_id || ''}
                disabled={savingId === booking.id}
                onChange={(e) => patch(booking, { staffId: e.target.value })}
              >
                <option value="">Not assigned</option>
                {staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </td>
            <td data-label="Status">
              <InlineSelect
                label={`Status for ${booking.participant_name}`}
                value={booking.status}
                disabled={savingId === booking.id}
                onChange={(next) => patch(booking, { status: next })}
                options={BOOKING_STATUSES}
              />
            </td>
          </tr>
        ))}
      </TableShell>

      <Pager page={list.page} pages={list.pages} total={list.total} limit={20} onChange={setPage} noun="bookings" />
    </div>
  );
};
