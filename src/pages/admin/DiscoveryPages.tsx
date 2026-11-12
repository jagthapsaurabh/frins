import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { PageHead } from '../../components/console/ConsoleUI';
import { ConfirmDialog } from '../../components/ConfirmDialog';

interface Question {
  id: string;
  prompt: string;
  domainTitle: string;
  domain?: string;
  inputType: 'single_choice' | 'text' | string;
  options?: Array<{ value: string; label: string }>;
  isActive: boolean;
}

const readOptions = (question?: Question | null) =>
  (question?.options || []).map((option) => (typeof option === 'string' ? option : option.label)).join('\n');

/** Question bank for the public Discovery flow. */
export const DiscoveryQuestionsPage: React.FC = () => {
  const { authFetch } = useAuth();
  const navigate = useNavigate();

  const [questions, setQuestions] = useState<Question[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [n, setN] = useState(7);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retireTarget, setRetireTarget] = useState<Question | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await authFetch('/api/admin/discovery-questions');
    const json = await res.json();
    if (res.ok && json.success) {
      setQuestions(json.questions || []);
      setActiveCount(json.activeCount || 0);
      setN(json.activeCount || 7);
      setError(null);
    } else {
      setError(json.error || 'Could not load the question bank.');
    }
    setLoading(false);
  }, [authFetch]);

  useEffect(() => {
    load();
  }, [load]);

  const applyCount = async () => {
    setBusy(true);
    const res = await authFetch('/api/admin/discovery-questions/set-count', {
      method: 'POST',
      body: JSON.stringify({ count: n })
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok || !json.success) {
      setError(json.error || 'Could not set the count.');
      return;
    }
    setBanner(`Discovery now asks ${json.activeCount} questions.`);
    load();
  };

  const retire = async () => {
    if (!retireTarget) return;
    setBusy(true);
    await authFetch(`/api/admin/discovery-questions/${retireTarget.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: false })
    });
    setBusy(false);
    setRetireTarget(null);
    load();
  };

  const term = q.trim().toLowerCase();
  const filtered = term
    ? questions.filter((row) => row.prompt.toLowerCase().includes(term) || row.domainTitle?.toLowerCase().includes(term))
    : questions;

  return (
    <div>
      <button type="button" className="back-link" onClick={() => navigate('/admin/discovery')}>
        <ArrowLeft size={14} /> Discovery results
      </button>

      <PageHead
        title="Question bank"
        meta={`${activeCount} live`}
        actions={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate('/admin/discovery/questions/new')}
          >
            <Plus size={14} /> Add question
          </button>
        }
      />

      {error && <div className="governance-alert danger">{error}</div>}
      {banner && <div className="governance-alert success">{banner}</div>}

      <div className="config-bar">
        <label htmlFor="discoveryCount">Questions shown on the public page</label>
        <input
          id="discoveryCount"
          type="number"
          min={1}
          max={50}
          className="form-input"
          value={n}
          onChange={(e) => setN(Number(e.target.value))}
        />
        <button type="button" className="btn btn-primary" onClick={applyCount} disabled={busy}>
          Apply
        </button>
        <span className="config-note">{activeCount} live in this order</span>
      </div>

      <div className="toolbar">
        <div className="search-field">
          <Search size={14} />
          <input
            className="form-input"
            placeholder="Search the bank"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search questions"
          />
        </div>
        <span className="toolbar-meta">
          {q.trim() ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'}` : `${activeCount} active`}
        </span>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 54 }}>#</th>
              <th>Question</th>
              <th>Domain</th>
              <th>Type</th>
              <th>Status</th>
              <th style={{ width: 96 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((question, index) => (
              <tr key={question.id}>
                <td className="num">{index + 1}</td>
                <td>
                  <span className="row-title">{question.prompt}</span>
                  <span className="row-sub">
                    {(question.options || []).length > 0
                      ? `${question.options!.length} options`
                      : 'Written answer'}
                  </span>
                </td>
                <td className="row-sub">{question.domainTitle}</td>
                <td className="row-sub">{question.inputType === 'text' ? 'Text' : 'Single choice'}</td>
                <td>
                  <span className={`status-pill ${question.isActive ? 'approved' : ''}`}>
                    {question.isActive ? 'Active' : 'Retired'}
                  </span>
                </td>
                <td>
                  <div className="table-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => navigate(`/admin/discovery/questions/${question.id}`)}
                      aria-label={`Edit question ${index + 1}`}
                    >
                      <Pencil size={13} />
                    </button>
                    {question.isActive && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setRetireTarget(question)}
                        aria-label={`Retire question ${index + 1}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <p className="section-note" style={{ padding: '8px 0' }}>No question matches that search.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={Boolean(retireTarget)}
        title="Retire this question?"
        message="It stops appearing on the Discovery page. Answers already collected stay where they are."
        confirmLabel="Retire"
        busy={busy}
        onConfirm={retire}
        onCancel={() => setRetireTarget(null)}
      />
    </div>
  );
};

/** Add or edit one question, on its own route. */
export const DiscoveryQuestionPage: React.FC = () => {
  const { questionId } = useParams();
  const isNew = questionId === 'new' || !questionId;
  const { authFetch } = useAuth();
  const navigate = useNavigate();

  const [prompt, setPrompt] = useState('');
  const [domainTitle, setDomainTitle] = useState('Preparation & Decision Structure');
  const [inputType, setInputType] = useState<'single_choice' | 'text'>('single_choice');
  const [optionsText, setOptionsText] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [loading, setLoading] = useState(!isNew);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isNew) return;
    authFetch('/api/admin/discovery-questions')
      .then((res) => (res.ok ? res.json() : { questions: [] }))
      .then((json) => {
        const found: Question | undefined = (json.questions || []).find((row: Question) => row.id === questionId);
        if (!found) {
          setError('That question no longer exists.');
        } else {
          setPrompt(found.prompt);
          setDomainTitle(found.domainTitle || '');
          setInputType(found.inputType === 'text' ? 'text' : 'single_choice');
          setOptionsText(readOptions(found));
          setIsActive(found.isActive);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [authFetch, isNew, questionId]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) {
      setError('Write the question first.');
      return;
    }
    const options = optionsText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    if (inputType === 'single_choice' && options.length < 2) {
      setError('A single choice question needs at least two options, one per line.');
      return;
    }

    setBusy(true);
    setError(null);
    const body = {
      prompt: prompt.trim(),
      domainTitle: domainTitle.trim(),
      inputType,
      options: inputType === 'single_choice' ? options : [],
      isActive
    };
    const res = await authFetch(
      isNew ? '/api/admin/discovery-questions' : `/api/admin/discovery-questions/${questionId}`,
      { method: isNew ? 'POST' : 'PATCH', body: JSON.stringify(body) }
    );
    const json = await res.json();
    setBusy(false);
    if (!res.ok || !json.success) {
      setError(json.error || 'Could not save the question.');
      return;
    }
    navigate('/admin/discovery/questions');
  };

  if (loading) return <p className="section-note">Loading the question.</p>;

  return (
    <div>
      <button type="button" className="back-link" onClick={() => navigate('/admin/discovery/questions')}>
        <ArrowLeft size={14} /> Discovery questions
      </button>

      <div className="page-head">
        <div>
          <h1>{isNew ? 'Add a question' : 'Question details'}</h1>
        </div>
      </div>

      {error && <div className="governance-alert danger">{error}</div>}

      <form onSubmit={save} className="form-layout">
        <section className="panel-card">
          <div className="form-group">
            <label className="form-label" htmlFor="q-prompt">Question</label>
            <textarea
              id="q-prompt"
              className="form-textarea"
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. When a trade goes against you, what decides the exit?"
              required
            />
          </div>

          <div className="form-row-2">
            <div className="form-group">
              <label className="form-label" htmlFor="q-domain">Domain</label>
              <input
                id="q-domain"
                className="form-input"
                value={domainTitle}
                onChange={(e) => setDomainTitle(e.target.value)}
                placeholder="e.g. Risk & Position Sizing"
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="q-type">Answer type</label>
              <select
                id="q-type"
                className="form-select"
                value={inputType}
                onChange={(e) => setInputType(e.target.value as 'single_choice' | 'text')}
              >
                <option value="single_choice">Single choice</option>
                <option value="text">Written answer</option>
              </select>
            </div>
          </div>

          {inputType === 'single_choice' && (
            <div className="form-group">
              <label className="form-label" htmlFor="q-options">Options, one per line</label>
              <textarea
                id="q-options"
                className="form-textarea"
                rows={5}
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                placeholder={'Yes, I follow a written rule\nSometimes, it depends on the day\nNo, I decide in the moment'}
              />
              <p className="form-hint">At least two. The order here is the order the candidate sees.</p>
            </div>
          )}

          <label className="check-row">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Ask this question on the public Discovery page
          </label>
        </section>

        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/admin/discovery')}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : isNew ? 'Add question' : 'Save question'}
          </button>
        </div>
      </form>
    </div>
  );
};
