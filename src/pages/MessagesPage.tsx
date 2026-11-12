import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, Search, Send, UserRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { PageHead } from '../components/console/ConsoleUI';
import { formatDateTime, timeAgo } from '../utils/dates';

interface ThreadRow {
  id: string;
  learner_id: string;
  learner_name: string;
  learner_email: string;
  last_message: string | null;
  last_sender: string | null;
  last_message_at: string | null;
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

const Bubble: React.FC<{ message: ChatMessage; mine: boolean }> = ({ message, mine }) => (
  <div className={`chat-bubble ${mine ? 'mine' : ''}`}>
    <div className="chat-bubble-meta">
      {mine ? 'You' : message.sender_name} · {formatDateTime(message.created_at)}
    </div>
    <div className="chat-bubble-text">{message.message}</div>
  </div>
);

/**
 * Direct messages between a learner and the team. One conversation per learner,
 * the same on both sides: staff see the list of learners, the learner sees the
 * team.
 */
export const MessagesPage: React.FC = () => {
  const { user, authFetch } = useAuth();
  const isLearner = user?.role === 'LEARNER';

  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [threadQuery, setThreadQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeLearner, setActiveLearner] = useState<any>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [mentorName, setMentorName] = useState('Your mentors');

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);

  const [learnerResults, setLearnerResults] = useState<any[]>([]);
  const [startingWith, setStartingWith] = useState<string | null>(null);

  const bubbleRef = useRef<HTMLDivElement | null>(null);

  const scrollToEnd = () => {
    const el = bubbleRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  const loadThreads = useCallback(async () => {
    if (isLearner) return;
    try {
      const res = await authFetch(`/api/chat/threads?q=${encodeURIComponent(threadQuery)}`);
      if (!res.ok) return;
      const json = await res.json();
      setThreads(json.rows || []);
      setActiveId((current) => current || json.rows?.[0]?.id || null);
    } catch {
      /* the pane below says what went wrong */
    }
  }, [authFetch, isLearner, threadQuery]);

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
        window.setTimeout(scrollToEnd, 60);
      } catch {
        setError('Could not reach the server.');
      } finally {
        setLoadingThread(false);
      }
    },
    [authFetch]
  );

  const loadMyThread = useCallback(
    async (quiet = false) => {
      try {
        const res = await authFetch('/api/chat/my-thread');
        if (!res.ok) return;
        const json = await res.json();
        setActiveId(json.thread?.id || null);
        setMessages(json.messages || []);
        setMentorName(json.mentorName || 'Your mentors');
        if (!quiet) window.setTimeout(scrollToEnd, 60);
      } catch {
        /* leave the empty state */
      }
    },
    [authFetch]
  );

  useEffect(() => {
    if (isLearner) {
      loadMyThread();
    } else {
      loadThreads();
    }
  }, [isLearner, loadMyThread, loadThreads]);

  useEffect(() => {
    if (isLearner || !activeId) return;
    loadThread(activeId);
  }, [activeId, isLearner, loadThread]);

  // A light poll keeps the other side's replies visible without a refresh.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (isLearner) {
        loadMyThread(true);
      } else if (activeId) {
        loadThread(activeId, true);
      }
    }, 20000);
    return () => window.clearInterval(timer);
  }, [activeId, isLearner, loadMyThread, loadThread]);

  // Staff can search for a learner who has no conversation yet.
  useEffect(() => {
    if (isLearner) return;
    const term = threadQuery.trim();
    if (term.length < 2) {
      setLearnerResults([]);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(async () => {
      try {
        const res = await authFetch(`/api/admin/learners?q=${encodeURIComponent(term)}&limit=6`);
        if (!res.ok) return;
        const json = await res.json();
        if (alive) setLearnerResults(json.rows || []);
      } catch {
        /* ignore */
      }
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [authFetch, isLearner, threadQuery]);

  const startChat = async (learnerId: string) => {
    setStartingWith(learnerId);
    const res = await authFetch('/api/chat/threads', {
      method: 'POST',
      body: JSON.stringify({ learnerId })
    });
    const json = await res.json();
    setStartingWith(null);
    if (!res.ok || !json.success) {
      setError(json.error || 'Could not start that conversation.');
      return;
    }
    setLearnerResults([]);
    setThreadQuery('');
    await loadThreads();
    setActiveId(json.threadId);
    loadThread(json.threadId);
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeId || !draft.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await authFetch(`/api/chat/threads/${activeId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ message: draft })
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || 'Could not send that message.');
        return;
      }
      setDraft('');
      setMessages((prev) => [...prev, json.message]);
      window.setTimeout(scrollToEnd, 60);
      if (!isLearner) loadThreads();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setSending(false);
    }
  };

  const otherName = isLearner ? mentorName : activeLearner?.name || 'the learner';
  const currentThread = threads.find((thread) => thread.id === activeId);

  return (
    <div className="messages-page">
      <PageHead title="Messages" />

      {error && <div className="governance-alert danger">{error}</div>}

      <div className={`chat-shell ${isLearner ? 'solo' : ''}`}>
        {!isLearner && (
          <aside className="panel-card chat-sidebar">
            <div className="chat-sidebar-head">
              <h3>Conversations</h3>
              <span className="admin-muted small">{threads.length}</span>
            </div>

            <div className="list-search-wrap chat-search">
              <Search size={15} />
              <input
                className="form-input list-search"
                placeholder="Search learners"
                value={threadQuery}
                onChange={(e) => setThreadQuery(e.target.value)}
                aria-label="Search learners to message"
              />
            </div>

            {learnerResults.length > 0 && (
              <div className="chat-result-list">
                <span className="chat-result-title">Start a new conversation</span>
                {learnerResults.map((learner) => (
                  <button
                    key={learner.id}
                    type="button"
                    className="chat-result"
                    onClick={() => startChat(learner.id)}
                    disabled={startingWith === learner.id}
                  >
                    <span className="chat-avatar">{initialsOf(learner.name)}</span>
                    <span className="chat-result-text">
                      <strong>{learner.name}</strong>
                      <small>{learner.email}</small>
                    </span>
                    <span className="chat-start-tag">{startingWith === learner.id ? 'Opening…' : 'Message'}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="chat-thread-list">
              {threads.length === 0 && (
                <p className="admin-muted small" style={{ padding: '10px 4px' }}>
                  No conversation yet. Search for a learner above and say hello.
                </p>
              )}
              {threads.map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  className={`chat-thread ${thread.id === activeId ? 'active' : ''}`}
                  onClick={() => setActiveId(thread.id)}
                >
                  <span className="chat-avatar">{initialsOf(thread.learner_name)}</span>
                  <span className="chat-thread-text">
                    <strong>
                      {thread.learner_name}
                      {thread.unread > 0 && <span className="chat-unread">{thread.unread}</span>}
                    </strong>
                    <small>
                      {thread.last_message
                        ? `${thread.last_sender === 'Learner' || thread.last_sender === thread.learner_name ? '' : ''}${thread.last_message}`
                        : 'No message yet'}
                    </small>
                  </span>
                  <span className="chat-thread-time">{thread.last_message_at ? timeAgo(thread.last_message_at) : ''}</span>
                </button>
              ))}
            </div>
          </aside>
        )}

        <section className="panel-card chat-pane">
          <div className="chat-pane-head">
            <div className="chat-pane-identity">
              <span className="chat-avatar lg">
                {isLearner ? <UserRound size={18} /> : initialsOf(activeLearner?.name || currentThread?.learner_name)}
              </span>
              <div>
                <strong>{isLearner ? mentorName : activeLearner?.name || 'Pick a conversation'}</strong>
                <small className="admin-muted">
                  {isLearner
                    ? 'Your guide and the FRINS team'
                    : activeLearner?.email || 'Choose a learner on the left'}
                </small>
              </div>
            </div>
            {isLearner && (
              <Link to="/dashboard/calls" className="btn btn-secondary btn-sm">
                Book a call instead
              </Link>
            )}
          </div>

          <div className="chat-bubbles" ref={bubbleRef}>
            {loadingThread && <p className="admin-muted small">Opening…</p>}
            {!loadingThread && messages.length === 0 && (
              <div className="chat-empty">
                <MessageSquare size={26} />
                <p>
                  {isLearner
                    ? 'Ask your mentor anything here. A doubt about a chart, a lesson or your plan.'
                    : 'Pick a learner, or search for one above, and start the conversation.'}
                </p>
              </div>
            )}
            {messages.map((message) => (
              <Bubble key={message.id} message={message} mine={message.sender_user_id === user?.id} />
            ))}
          </div>

          <form className="chat-composer" onSubmit={send}>
            <input
              className="form-input"
              placeholder={isLearner ? `Message ${otherName}` : `Message ${otherName}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={!activeId}
              aria-label="Write a message"
            />
            <button type="submit" className="btn btn-primary" disabled={!activeId || sending || !draft.trim()}>
              <Send size={15} /> {sending ? 'Sending…' : 'Send'}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
};
