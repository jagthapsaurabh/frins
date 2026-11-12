import React from 'react';

interface PagerProps {
  page: number;
  pages: number;
  total: number;
  limit: number;
  onChange: (page: number) => void;
  /** What is being counted, e.g. "learners". */
  noun?: string;
}

const range = (from: number, to: number) => {
  const out: number[] = [];
  for (let i = from; i <= to; i += 1) out.push(i);
  return out;
};

/**
 * One pager for every long list.
 *
 * A roster of a thousand learners is twenty pages of fifty. The pager always
 * says where you are and how much is left, so nobody has to guess whether they
 * are looking at everything or at the first slice.
 */
export const Pager: React.FC<PagerProps> = ({ page, pages, total, limit, onChange, noun = 'rows' }) => {
  if (total === 0) return null;

  const from = (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);

  // At most five page buttons around the current page.
  let start = Math.max(1, page - 2);
  let end = Math.min(pages, start + 4);
  start = Math.max(1, end - 4);

  const numbers = range(start, end);

  return (
    <div className="pager">
      <span className="pager-count">
        {from}&ndash;{to} of {total.toLocaleString()} {noun}
      </span>
      <div className="pager-controls">
        <button
          type="button"
          className="pager-btn"
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          Prev
        </button>
        {start > 1 && (
          <>
            <button type="button" className="pager-btn" onClick={() => onChange(1)}>
              1
            </button>
            {start > 2 && <span className="pager-gap">...</span>}
          </>
        )}
        {numbers.map((n) => (
          <button
            key={n}
            type="button"
            className={`pager-btn ${n === page ? 'active' : ''}`}
            onClick={() => onChange(n)}
            aria-current={n === page ? 'page' : undefined}
          >
            {n}
          </button>
        ))}
        {end < pages && (
          <>
            {end < pages - 1 && <span className="pager-gap">...</span>}
            <button type="button" className="pager-btn" onClick={() => onChange(pages)}>
              {pages}
            </button>
          </>
        )}
        <button
          type="button"
          className="pager-btn"
          onClick={() => onChange(page + 1)}
          disabled={page >= pages}
          aria-label="Next page"
        >
          Next
        </button>
      </div>
    </div>
  );
};
