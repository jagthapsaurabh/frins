import React from 'react';
import { Search } from 'lucide-react';

/**
 * The console layout kit.
 *
 * Every tab in the admin console is built from the same four blocks, in the
 * same order: a title row, a toolbar, a table, and a pager. Anything that used
 * to be a form inside a list is a route of its own. Keeping the blocks here
 * means a new screen cannot drift away from the rest.
 */

export const PageHead: React.FC<{
  title: string;
  actions?: React.ReactNode;
  /** Optional count beside the title, e.g. "128 learners". */
  meta?: string;
}> = ({ title, actions, meta }) => (
  <div className="page-head">
    <div className="page-head-title">
      <h1>{title}</h1>
      {meta && <span className="page-head-meta">{meta}</span>}
    </div>
    {actions && <div className="page-head-actions">{actions}</div>}
  </div>
);

export const SearchBox: React.FC<{
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
}> = ({ value, onChange, placeholder = 'Search', label }) => (
  <div className="search-field">
    <Search size={14} />
    <input
      className="form-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={label || placeholder}
    />
  </div>
);

export const Toolbar: React.FC<{
  children: React.ReactNode;
  meta?: React.ReactNode;
}> = ({ children, meta }) => (
  <div className="toolbar">
    {children}
    {meta && <span className="toolbar-meta">{meta}</span>}
  </div>
);

export const FilterSelect: React.FC<{
  value: string;
  onChange: (value: string) => void;
  label: string;
  options: Array<{ value: string; label: string }>;
}> = ({ value, onChange, label, options }) => (
  <select
    className="form-select"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    aria-label={label}
    style={{ width: 'auto' }}
  >
    {options.map((option) => (
      <option key={option.value} value={option.value}>
        {option.label}
      </option>
    ))}
  </select>
);

export const TableShell: React.FC<{
  columns: Array<{ label: string; width?: number | string; align?: 'right' }>;
  children: React.ReactNode;
  loading?: boolean;
  empty?: React.ReactNode;
  isEmpty?: boolean;
}> = ({ columns, children, loading, empty, isEmpty }) => (
  <div className="table-wrap">
    <table className="data-table">
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              key={column.label}
              style={{ width: column.width, textAlign: column.align === 'right' ? 'right' : undefined }}
            >
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {children}
        {isEmpty && (
          <tr>
            <td colSpan={columns.length}>
              <div className="table-empty">{loading ? 'Loading.' : empty || 'Nothing here yet.'}</div>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
);

export const StatusPill: React.FC<{ status: string; tone?: 'approved' | 'info' | 'warn' | 'danger' | '' }> = ({
  status,
  tone
}) => <span className={`status-pill ${tone || ''}`}>{status.replace(/_/g, ' ')}</span>;

/** The status words used for tasks, in one place so the list and the page agree. */
export const TASK_STATUS: Record<string, { label: string; tone: string }> = {
  ASSIGNED: { label: 'To start', tone: 'info' },
  IN_PROGRESS: { label: 'In progress', tone: 'info' },
  SUBMITTED: { label: 'Waiting review', tone: 'warn' },
  REVIEWED: { label: 'Reviewed', tone: 'approved' },
  APPROVED: { label: 'Approved', tone: 'approved' },
  CHANGES_REQUESTED: { label: 'Sent back', tone: 'danger' }
};

export const toneFor = (status: string) => TASK_STATUS[status]?.tone || '';
export const labelFor = (status: string) => TASK_STATUS[status]?.label || status.replace(/_/g, ' ');

/** A status picker that lives inside a table cell. Flat until you touch it. */
export const InlineSelect: React.FC<{
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  label: string;
  disabled?: boolean;
}> = ({ value, onChange, options, label, disabled }) => (
  <select
    className="row-select"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    aria-label={label}
    disabled={disabled}
  >
    {options.map((option) => (
      <option key={option.value} value={option.value}>
        {option.label}
      </option>
    ))}
  </select>
);
