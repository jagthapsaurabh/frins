import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, MessageSquare, Plus, Search, Send, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PageHead, FilterSelect } from '../components/console/ConsoleUI';
import { Pager } from '../components/Pager';
// Dates are formatted in the helpers above.

interface ThreadRow {
  id: string;
  learner_id: string;
  learner_name: string;
  learner_email: string;
  last_message: string | null;
  last_sender: string | null;
  last_message_sent_at: string | null;
  unread: number;
}

interface ChatMessage {
  id: string;
  sender_user_id: string;
  sender_name: string;
  sender_role: string;
  message: string;
  created_at: string;
}

const initialsOf = (name?: string) =>
  (name || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

const dayLabel = (value: string) => {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

const clock = (value: string) =>
  new Date(value).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });

/**
 * Direct messages. Staff get a searchable, paged inbox that still behaves at a
 * thousand learners; a learner gets the same conversation without the inbox.
 */
export const MessagesPage: React.FC = () => {
  const { user, authFetch } = useAuth();
  const isLearner = user?.role === 'LEARNER';

  // Inbox state (staff only)
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [listLoading, setListLoading] = useState(true);

  // Active conversation
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeLearner, setActiveLearner] = useState<any>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [mentorName, setMentorName] = useState('The FRINS team');
  const [loadingThread, setLoadingThread] = useState(false);
  const [mobileThread, setMobileThread] = useState(false);

  // Composer
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Start a new conversation
  const [pickerOpen, setPickerOpen] = useState(false);
  const [people, setPeople] = useState<any[]>([]);
  const [peopleQuery, setPeopleQuery] = useState('');
  const [peopleLoading, setPeopleLoading] = useState(false);

  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const scrollToEnd = () => {
    const el = bubbleRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [filter]);

  const loadThreads = useCallback(
    async (quiet = false) => {
      if (isLearner) return;
      if (!quiet) setListLoading(true);
      try {
        const params = new URLSearchParams({ page: String(page), limit: '30', filter });
        if (query) params.set('q', query);
        const res = await authFetch(`/api/chat/threads?${params.toString()}`);
        if (!res.ok) return;
        const json = await res.json();
        setThreads(json.rows || []);
        setTotal(json.total || 0);
        setPages(json.pages || 1);
        setUnreadTotal(json.unreadTotal || 0);
        setActiveId((current) => {
          if (current && (json.rows || []).some((row: ThreadRow) => row.id === current)) return current;
          return json.rows?.[0]?.id || null;
        });
      } catch {
        /* the pane below says what went wrong */
      } finally {
        if (!quiet) setListLoading(false);
      }
    },
    [authFetch, filter, isLearner, page, query]
  );

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  const loadThread = useCallback(
    async (threadId: string, quiet = false) => {
      if (!quiet) setLoadingThread(true);
      try {
        const res = await authFetch(`/api/chat/threads/${threadId}`);
        if (!res.ok) {
          setError('Could not open this conversation.');
          return;
        }
        const json = await res.json();
        setMessages(json.messages || []);
        setActiveLearner(json.learner || null);
        setError(null);
        if (!quiet) window.setTimeout(scrollToEnd, 60);
      } catch {
        setError('Could not reach the server.');
      } finally {
        if (!quiet) setLoadingThread(false);
      }
    },
    [authFetch]
  );

  const loadMyThread = useCallback(async (quiet = false) => {
    try {
      const res = await authFetch('/api/chat/my-thread');
      if (!res.ok) return;
      const json = await res.json();
      setActiveId(json.thread?.id || null);
      setMessages(json.messages || []);
      if (json.mentorName) setMentorName(json.mentorName);
      if (!quiet) window.setTimeout(scrollToEnd, 60);
    } catch {
      /* the empty state covers it */
    }
  }, [authFetch]);

  useEffect(() => {
    if (isLearner) {
      loadMyThread();
    } else if (activeId) {
      loadThread(activeId);
    }
  }, [isLearner, activeId, loadThread, loadMyThread]);

  // Keep the open conversation fresh. A daily queue should not need a refresh.
  useEffect(() => {
    const timer = setInterval(() => {
      if (isLearner) {
        loadMyThread(true);
      } else {
        loadThreads(true);
        if (activeId) loadThread(activeId, true);
      }
    }, 20000);
    return () => clearInterval(timer);
  }, [activeId, isLearner, loadThread, loadThreads, loadMyThread]);

  const openThread = (id: string) => {
    setActiveId(id);
    setMobileThread(true);
    setDraft('');
  };

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || !activeId) return;
    setSending(true);
    setError(null);
    const res = await authFetch(`/api/chat/threads/${activeId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ message: text })
    });
    setSending(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error || 'Could not send that message.');
      return;
    }
    setDraft('');
    if (isLearner) {
      await loadMyThread(true);
    } else {
      await loadThread(activeId, true);
      await loadThreads(true);
    }
    window.setTimeout(scrollToEnd, 60);
    composerRef.current?.focus();
  };

  const searchPeople = useCallback(
    async (value: string) => {
      setPeopleLoading(true);
      try {
        const res = await authFetch(`/api/admin/learners?q=${encodeURIComponent(value)}&limit=12`);
        if (res.ok) {
          const json = await res.json();
          setPeople(json.rows || []);
        }
      } finally {
        setPeopleLoading(false);
      }
    },
    [authFetch]
  );

  useEffect(() => {
    if (!pickerOpen) return;
    const timer = setTimeout(() => searchPeople(peopleQuery.trim()), 200);
    return () => clearTimeout(timer);
  }, [pickerOpen, peopleQuery, searchPeople]);

  const startWith = async (learnerId: string) => {
    const res = await authFetch('/api/chat/threads', {
      method: 'POST',
      body: JSON.stringify({ learnerId })
    });
    if (!res.ok) return;
    const json = await res.json();
    setPickerOpen(false);
    setPeopleQuery('');
    setFilter('ALL');
    setSearch('');
    setQuery('');
    setPage(1);
    setActiveId(json.threadId);
    setMobileThread(true);
    await loadThreads();
  };

  const activeThread = threads.find((thread) => thread.id === activeId);
  const headerName = isLearner ? mentorName : activeLearner?.name || activeThread?.learner_name || 'Conversation';
  const headerEmail = isLearner ? 'Your guide and the FRINS team' : activeLearner?.email || activeThread?.learner_email || '';

  // Group messages by day so a long thread stays readable.
  const groups: Array<{ label: string; items: ChatMessage[] }> = [];
  messages.forEach((message) => {
    const label = dayLabel(message.created_at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(message);
    else groups.push({ label, items: [message] });
  });

  return (
    <div className="messages-page">
      <PageHead
        title="Messages"
        meta={
          isLearner
            ? 'One conversation with your guide'
            : total > 0
              ? `${total} ${total === 1 ? 'conversation' : 'conversations'}${unreadTotal ? `, ${unreadTotal} unread` : ''}`
              : undefined
        }
        actions={
          !isLearner ? (
            <button type="button" className="btn btn-primary" onClick={() => setPickerOpen(true)}>
              <Plus size={14} /> New message
            </button>
          ) : undefined
        }
      />

      {error && <div className="governance-alert danger">{error}</div>}

      <div className={`inbox ${mobileThread ? 'thread-open' : ''} ${isLearner ? 'solo' : ''}`}>
        {!isLearner && (
          <aside className="inbox-list">
            <div className="inbox-tools">
              <div className="search-field">
                <Search size={14} />
                <input
                  className="form-input"
                  placeholder="Search by name or email"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search conversations"
                />
              </div>
              <FilterSelect
                label="Filter conversations"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'ALL', label: unreadTotal ? `All chats · ${unreadTotal} unread` : 'All chats' },
                  { value: 'UNREAD', label: 'Unread' }
                ]}
              />
            </div>

            <div className="inbox-rows">
              {listLoading && threads.length === 0 && <p className="inbox-note">Loading conversations.</p>}
              {!listLoading && threads.length === 0 && (
                <div className="inbox-empty">
                  <MessageSquare size={18} />
                  <strong>{query || filter === 'UNREAD' ? 'Nothing matches' : 'No conversations yet'}</strong>
                  <span>
                    {query || filter === 'UNREAD'
                      ? 'Try another name, or clear the filter.'
                      : 'Start one with the button above.'}
                  </span>
                </div>
              )}
              {threads.map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  className={`inbox-row ${activeId === thread.id ? 'active' : ''}`}
                  onClick={() => openThread(thread.id)}
                >
                  <span className="inbox-avatar">{initialsOf(thread.learner_name)}</span>
                  <span className="inbox-row-body">
                    <span className="inbox-row-top">
                      <strong>{thread.learner_name}</strong>
                      <small>{thread.last_message_sent_at ? dayLabel(thread.last_message_sent_at) : ''}</small>
                    </span>
                    <span className="inbox-row-preview">
                      {thread.last_sender ? `${thread.last_sender.split(' ')[0]}: ` : ''}
                      {thread.last_message || 'No messages yet'}
                    </span>
                  </span>
                  {thread.unread > 0 && <span className="inbox-badge">{thread.unread}</span>}
                </button>
              ))}
            </div>

            {pages > 1 && (
              <div className="inbox-pager">
                <Pager page={page} pages={pages} total={total} limit={30} onChange={setPage} noun="chats" />
              </div>
            )}
          </aside>
        )}

        <section className="inbox-thread">
          <header className="inbox-thread-head">
            {!isLearner && (
              <button
                type="button"
                className="inbox-back"
                onClick={() => setMobileThread(false)}
                aria-label="Back to conversations"
              >
                <ArrowLeft size={16} />
              </button>
            )}
            <span className="inbox-avatar large">{initialsOf(headerName)}</span>
            <div className="inbox-thread-id">
              <strong>{headerName}</strong>
              <small>{headerEmail}</small>
            </div>
            {!isLearner && activeLearner?.id && (
              <Link className="btn btn-secondary btn-sm" to={`/admin/learners/${activeLearner.id}`}>
                Open learner
              </Link>
            )}
          </header>

          <div className="chat-bubbles inbox-bubbles" ref={bubbleRef}>
            {loadingThread && messages.length === 0 && <p className="inbox-note">Opening the conversation.</p>}
            {!loadingThread && messages.length === 0 && (
              <div className="inbox-empty">
                <MessageSquare size={18} />
                <strong>No messages yet</strong>
                <span>Say hello. A short question gets a faster answer.</span>
              </div>
            )}

            {groups.map((group) => (
              <div key={group.label} className="chat-day">
                <span>{group.label}</span>
                {group.items.map((message) => {
                  const fromLearner = message.sender_role === 'LEARNER';
                  const mine = isLearner ? fromLearner : !fromLearner;
                  return (
                    <div key={message.id} className={`chat-bubble ${mine ? 'mine' : ''}`}>
                      <div className="chat-bubble-meta">
                        {mine ? 'You' : message.sender_name} · {clock(message.created_at)}
                      </div>
                      <div className="chat-bubble-text">{message.message}</div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <form className="chat-composer" onSubmit={send}>
            <textarea
              ref={composerRef}
              className="form-textarea"
              rows={1}
              placeholder={isLearner ? 'Message your guide' : `Message ${headerName.split(' ')[0]}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              aria-label="Write a message"
            />
            <button type="submit" className="btn btn-primary" disabled={sending || !draft.trim()}>
              <Send size={15} /> Send
            </button>
          </form>
        </section>
      </div>

      {pickerOpen && (
        <div className="confirm-overlay" onMouseDown={(e) => e.target === e.currentTarget && setPickerOpen(false)}>
          <div className="confirm-card" style={{ width: 460, maxWidth: '92vw' }}>
            <button type="button" className="confirm-close" onClick={() => setPickerOpen(false)} aria-label="Close">
              <X size={16} />
            </button>
            <h3>New message</h3>
            <p className="confirm-message">Search for the person you want to write to.</p>
            <div className="search-field" style={{ marginBottom: 10 }}>
              <Search size={14} />
              <input
                className="form-input"
                autoFocus
                placeholder="Name or email"
                value={peopleQuery}
                onChange={(e) => setPeopleQuery(e.target.value)}
                aria-label="Search learners"
              />
            </div>
            <div className="pick-list" style={{ maxHeight: 280 }}>
              {peopleLoading && people.length === 0 && <p className="section-note" style={{ padding: 10 }}>Searching.</p>}
              {people.map((person) => (
                <button
                  key={person.id}
                  type="button"
                  className="pick-row"
                  onClick={() => startWith(person.id)}
                  style={{ width: '100%', border: 0, background: 'transparent', textAlign: 'left' }}
                >
                  <span className="pick-avatar">{initialsOf(person.name)}</span>
                  <span>
                    <strong style={{ display: 'block' }}>{person.name}</strong>
                    <small className="row-sub">{person.email}</small>
                  </span>
                </button>
              ))}
              {!peopleLoading && people.length === 0 && peopleQuery && (
                <p className="section-note" style={{ padding: 10 }}>Nobody matches that.</p>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
