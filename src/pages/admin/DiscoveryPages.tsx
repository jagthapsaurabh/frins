import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { PageHead } from '../../components/console/ConsoleUI';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import {
  EXPERIENCE_OPTIONS,
  ROLE_OPTIONS,
  TONE_OPTIONS,
  DEFAULT_SETTINGS,
  type DiscoverySettings,
  type OutcomeCopy,
  type ShowIfRule
} from '../../shared/discoveryFlow';

interface QuestionOption {
  value: string;
  label: string;
  outcome?: OutcomeCopy;
}

interface Question {
  id: string;
  prompt: string;
  domainTitle: string;
  domain?: string;
  inputType: 'single_choice' | 'text' | string;
  options?: Array<string | QuestionOption>;
  order?: number;
  audience?: string[];
  experience?: string[];
  showIf?: ShowIfRule[];
  askInFlow?: boolean;
  resultNote?: string;
  isActive: boolean;
}

const optionsOf = (question?: Question | null): QuestionOption[] =>
  (question?.options || []).map((option, index) =>
    typeof option === 'string'
      ? { value: '', label: option }
      : {
          value: option.value || '',
          label: option.label,
          outcome: option.outcome || {
            title: '',
            body: '',
            tone: 'developing'
          },
          // keep the position stable when the row is re-read
          ...(index < 0 ? {} : {})
        }
  );

const roleNames = (roles?: string[]) =>
  !roles || roles.length === 0
    ? 'Everyone'
    : roles
        .map((role) => ROLE_OPTIONS.find((option) => option.value === role)?.label || role)
        .join(', ');

/** The bank, the count and the gate that unlocks a result. */
export const DiscoveryQuestionsPage: React.FC = () => {
  const { authFetch } = useAuth();
  const navigate = useNavigate();

  const [questions, setQuestions] = useState<Question[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [settings, setSettings] = useState<DiscoverySettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retireTarget, setRetireTarget] = useState<Question | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [res, settingsRes] = await Promise.all([
      authFetch('/api/admin/discovery-questions'),
      authFetch('/api/admin/discovery-questions/settings')
    ]);
    const json = await res.json();
    if (res.ok && json.success) {
      setQuestions(json.questions || []);
      setActiveCount(json.activeCount || 0);
      setError(null);
    } else {
      setError(json.error || 'Could not load the question bank.');
    }
    const settingsJson = await settingsRes.json().catch(() => null);
    if (settingsRes.ok && settingsJson?.success) {
      setSettings(settingsJson.settings);
    }
    setLoading(false);
  }, [authFetch]);

  useEffect(() => {
    load();
  }, [load]);

  const saveSettings = async (next: DiscoverySettings) => {
    setBusy(true);
    const res = await authFetch('/api/admin/discovery-questions/settings', {
      method: 'POST',
      body: JSON.stringify(next)
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok || !json.success) {
      setError(json.error || 'Could not save those numbers.');
      return;
    }
    setSettings(json.settings);
    setBanner(
      `Saved. Discovery asks up to ${json.settings.maxQuestions} questions, and a result opens after ${json.settings.minAnswers}.`
    );
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
    ? questions.filter(
        (row) =>
          row.prompt.toLowerCase().includes(term) ||
          row.domainTitle?.toLowerCase().includes(term) ||
          roleNames(row.audience).toLowerCase().includes(term)
      )
    : questions;

  const inFlow = questions.filter((row) => row.isActive && row.askInFlow !== false).length;

  return (
    <div>
      <button type="button" className="back-link" onClick={() => navigate('/admin/discovery')}>
        <ArrowLeft size={14} /> Discovery results
      </button>

      <PageHead
        title="Question bank"
        meta={`${activeCount} live · ${inFlow} in the flow`}
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

      <section className="panel-card disc-settings">
        <div className="panel-head">
          <div>
            <h2>How the flow runs</h2>
            <p className="section-note">
              Each question carries its own audience and its own conditions. The two numbers below sit on top
              of that.
            </p>
          </div>
        </div>

        <div className="disc-settings-grid">
          <div className="form-group">
            <label className="form-label" htmlFor="discoveryMin">
              Answers before a result opens
            </label>
            <input
              id="discoveryMin"
              type="number"
              min={1}
              max={20}
              className="form-input"
              value={settings.minAnswers}
              onChange={(e) => setSettings({ ...settings, minAnswers: Number(e.target.value) })}
            />
            <p className="form-hint">Three is the default. Someone can submit the moment they reach it.</p>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="discoveryMax">
              Questions shown at most
            </label>
            <input
              id="discoveryMax"
              type="number"
              min={settings.minAnswers}
              max={40}
              className="form-input"
              value={settings.maxQuestions}
              onChange={(e) => setSettings({ ...settings, maxQuestions: Number(e.target.value) })}
            />
            <p className="form-hint">Only questions that match the person's role and answers count.</p>
          </div>

          <div className="disc-settings-action">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => saveSettings(settings)}
              disabled={busy}
            >
              Save these numbers
            </button>
          </div>
        </div>
      </section>

      <div className="toolbar">
        <div className="search-field">
          <Search size={14} />
          <input
            className="form-input"
            placeholder="Search the bank, or a role"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search questions"
          />
        </div>
        <span className="toolbar-meta">
          {q.trim() ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'}` : `${questions.length} in the bank`}
        </span>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 54 }}>#</th>
              <th>Question</th>
              <th>Shown to</th>
              <th style={{ width: 90 }}>In flow</th>
              <th>Status</th>
              <th style={{ width: 96 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((question) => (
              <tr key={question.id}>
                <td className="num">{question.order ?? 0}</td>
                <td>
                  <span className="row-title">{question.prompt}</span>
                  <span className="row-sub">
                    {question.domainTitle}
                    {(question.showIf || []).length > 0 ? ' · has a condition' : ''}
                  </span>
                </td>
                <td className="row-sub">{roleNames(question.audience)}</td>
                <td className="row-sub">{question.askInFlow === false ? 'No' : 'Yes'}</td>
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
                      aria-label={`Edit question ${question.order ?? ''}`}
                    >
                      <Pencil size={13} />
                    </button>
                    {question.isActive && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setRetireTarget(question)}
                        aria-label={`Retire question ${question.order ?? ''}`}
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
                  <p className="section-note" style={{ padding: '8px 0' }}>
                    No question matches that search.
                  </p>
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

/**
 * Add or edit one question, including who sees it and when, and what each
 * answer says in the result.
 */
export const DiscoveryQuestionPage: React.FC = () => {
  const { questionId } = useParams();
  const isNew = questionId === 'new' || !questionId;
  const { authFetch } = useAuth();
  const navigate = useNavigate();

  const [prompt, setPrompt] = useState('');
  const [domainTitle, setDomainTitle] = useState('Preparation & Decision Structure');
  const [inputType, setInputType] = useState<'single_choice' | 'text'>('single_choice');
  const [options, setOptions] = useState<QuestionOption[]>([]);
  const [isActive, setIsActive] = useState(true);
  const [askInFlow, setAskInFlow] = useState(true);
  const [order, setOrder] = useState<number>(1);
  const [audience, setAudience] = useState<string[]>([]);
  const [experience, setExperience] = useState<string[]>([]);
  const [showIf, setShowIf] = useState<ShowIfRule[]>([]);
  const [resultNote, setResultNote] = useState('');

  const [bank, setBank] = useState<Question[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authFetch('/api/admin/discovery-questions')
      .then((res) => (res.ok ? res.json() : { questions: [] }))
      .then((json) => {
        const rows: Question[] = json.questions || [];
        setBank(rows);

        if (isNew) {
          const highest = rows.reduce((max, row) => Math.max(max, Number(row.order) || 0), 0);
          setOrder(highest + 1);
          setOptions([
            { value: '', label: '', outcome: { title: '', body: '', tone: 'developing' } },
            { value: '', label: '', outcome: { title: '', body: '', tone: 'developing' } }
          ]);
        } else {
          const found = rows.find((row) => row.id === questionId);
          if (!found) {
            setError('That question no longer exists.');
          } else {
            setPrompt(found.prompt);
            setDomainTitle(found.domainTitle || '');
            setInputType(found.inputType === 'text' ? 'text' : 'single_choice');
            setOptions(optionsOf(found));
            setIsActive(found.isActive);
            setAskInFlow(found.askInFlow !== false);
            setOrder(Number(found.order) || 1);
            setAudience(found.audience || []);
            setExperience(found.experience || []);
            setShowIf(found.showIf || []);
            setResultNote(found.resultNote || '');
          }
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [authFetch, isNew, questionId]);

  const ruleSources = useMemo(
    () => bank.filter((row) => row.id !== questionId && row.options && row.options.length > 0),
    [bank, questionId]
  );

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  const updateOption = (index: number, patch: Partial<QuestionOption>) =>
    setOptions((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const updateOutcome = (index: number, patch: Partial<OutcomeCopy>) =>
    setOptions((rows) =>
      rows.map((row, i) =>
        i === index
          ? { ...row, outcome: { ...(row.outcome || { title: '', body: '', tone: 'developing' }), ...patch } }
          : row
      )
    );

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) {
      setError('Write the question first.');
      return;
    }

    const cleanedOptions = options.filter((option) => option.label.trim());
    if (inputType === 'single_choice' && cleanedOptions.length < 2) {
      setError('A single choice question needs at least two options.');
      return;
    }

    setBusy(true);
    setError(null);

    const body = {
      prompt: prompt.trim(),
      domainTitle: domainTitle.trim(),
      inputType,
      options:
        inputType === 'single_choice'
          ? cleanedOptions.map((option) => ({
              value: option.value || undefined,
              label: option.label.trim(),
              outcome:
                option.outcome && (option.outcome.title.trim() || option.outcome.body.trim())
                  ? {
                      title: option.outcome.title.trim(),
                      body: option.outcome.body.trim(),
                      tone: option.outcome.tone
                    }
                  : undefined
            }))
          : [],
      isActive,
      askInFlow,
      order,
      audience,
      experience,
      showIf: showIf.filter((rule) => rule.questionId && rule.values.length > 0),
      resultNote: resultNote.trim()
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
          <p>
            A question can be aimed at one role, one experience band, or opened only by an earlier answer.
          </p>
        </div>
      </div>

      {error && <div className="governance-alert danger">{error}</div>}

      <form onSubmit={save} className="form-layout">
        <section className="panel-card">
          <div className="form-group">
            <label className="form-label" htmlFor="q-prompt">
              Question
            </label>
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
              <label className="form-label" htmlFor="q-domain">
                Domain
              </label>
              <input
                id="q-domain"
                className="form-input"
                value={domainTitle}
                onChange={(e) => setDomainTitle(e.target.value)}
                placeholder="e.g. Risk & Position Sizing"
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="q-type">
                Answer type
              </label>
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

          <div className="form-group">
            <label className="form-label" htmlFor="q-note">
              The line under the question
            </label>
            <input
              id="q-note"
              className="form-input"
              value={resultNote}
              onChange={(e) => setResultNote(e.target.value)}
              placeholder="e.g. It tells us whether your exits are planned or improvised."
              maxLength={160}
            />
            <p className="form-hint">Optional. One sentence that says why we ask. Leave it empty and we write one.</p>
          </div>
        </section>

        <section className="panel-card">
          <div className="panel-head">
            <div>
              <h2>Who sees it</h2>
              <p className="section-note">Leave a group empty and the question is open to everyone in it.</p>
            </div>
          </div>

          <div className="form-row-2">
            <div className="form-group">
              <span className="form-label">Position in the flow</span>
              <input
                type="number"
                min={1}
                max={999}
                className="form-input"
                value={order}
                onChange={(e) => setOrder(Number(e.target.value))}
                aria-label="Position in the flow"
              />
              <p className="form-hint">Lower numbers come first.</p>
            </div>

            <div className="form-group">
              <span className="form-label">In the public flow</span>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={askInFlow}
                  onChange={(e) => setAskInFlow(e.target.checked)}
                />
                Ask this question
              </label>
              <p className="form-hint">
                A question can stay active in the bank without being asked on the website.
              </p>
            </div>
          </div>

          <div className="form-group">
            <span className="form-label">Roles</span>
            <div className="disc-chip-grid">
              {ROLE_OPTIONS.map((role) => (
                <label key={role.value} className={`disc-chip ${audience.includes(role.value) ? 'on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={audience.includes(role.value)}
                    onChange={() => setAudience((list) => toggle(list, role.value))}
                  />
                  {role.label}
                </label>
              ))}
            </div>
            <p className="form-hint">{audience.length ? `Only ${roleNames(audience)}.` : 'Everyone, until you pick a role.'}</p>
          </div>

          <div className="form-group">
            <span className="form-label">Experience</span>
            <div className="disc-chip-grid">
              {EXPERIENCE_OPTIONS.map((band) => (
                <label key={band.value} className={`disc-chip ${experience.includes(band.value) ? 'on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={experience.includes(band.value)}
                    onChange={() => setExperience((list) => toggle(list, band.value))}
                  />
                  {band.label}
                </label>
              ))}
            </div>
            <p className="form-hint">
              {experience.length
                ? 'Only people in that band. Everyone gets the question when this is empty.'
                : 'Everyone, whatever their experience.'}
            </p>
          </div>
        </section>

        <section className="panel-card">
          <div className="panel-head">
            <div>
              <h2>Only ask when</h2>
              <p className="section-note">
                Every condition has to be met before the question appears. Leave this empty and the question
                is always asked.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() =>
                setShowIf((rules) => [
                  ...rules,
                  { questionId: ruleSources[0]?.id || '', values: [], roles: [] }
                ])
              }
              disabled={ruleSources.length === 0}
            >
              <Plus size={13} /> Add condition
            </button>
          </div>

          {showIf.length === 0 && (
            <p className="section-note">No condition. This question is asked whenever the role and experience match.</p>
          )}

          {showIf.map((rule, index) => {
            const source = bank.find((row) => row.id === rule.questionId);
            const sourceOptions = (source?.options || []).map((option) =>
              typeof option === 'string' ? { value: option, label: option } : option
            );

            return (
              <div className="disc-rule" key={`${rule.questionId}-${index}`}>
                <div className="disc-rule-top">
                  <span className="disc-rule-num">Condition {index + 1}</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setShowIf((rules) => rules.filter((_, i) => i !== index))}
                    aria-label="Remove condition"
                  >
                    <X size={13} />
                  </button>
                </div>

                <div className="form-row-2">
                  <div className="form-group">
                    <label className="form-label">Earlier question</label>
                    <select
                      className="form-select"
                      value={rule.questionId}
                      onChange={(e) =>
                        setShowIf((rules) =>
                          rules.map((row, i) =>
                            i === index ? { ...row, questionId: e.target.value, values: [] } : row
                          )
                        )
                      }
                    >
                      <option value="">Pick a question</option>
                      {ruleSources.map((row) => (
                        <option key={row.id} value={row.id}>
                          {(row.order ?? '?') + '. ' + row.prompt.slice(0, 60)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Only for these roles</label>
                    <div className="disc-chip-grid disc-chip-grid--tight">
                      {ROLE_OPTIONS.map((role) => (
                        <label
                          key={role.value}
                          className={`disc-chip disc-chip--sm ${rule.roles.includes(role.value) ? 'on' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={rule.roles.includes(role.value)}
                            onChange={() =>
                              setShowIf((rules) =>
                                rules.map((row, i) =>
                                  i === index ? { ...row, roles: toggle(row.roles, role.value) } : row
                                )
                              )
                            }
                          />
                          {role.label}
                        </label>
                      ))}
                    </div>
                    <p className="form-hint">None ticked means the condition applies to every role.</p>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">When the answer is</label>
                  {sourceOptions.length > 0 ? (
                    <div className="disc-chip-grid disc-chip-grid--wide">
                      {sourceOptions.map((option) => (
                        <label
                          key={option.value}
                          className={`disc-chip ${rule.values.includes(option.value) ? 'on' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={rule.values.includes(option.value)}
                            onChange={() =>
                              setShowIf((rules) =>
                                rules.map((row, i) =>
                                  i === index ? { ...row, values: toggle(row.values, option.value) } : row
                                )
                              )
                            }
                          />
                          {option.label}
                        </label>
                      ))}
                    </div>
                  ) : (
                    <input
                      className="form-input"
                      value={rule.values.join(', ')}
                      onChange={(e) =>
                        setShowIf((rules) =>
                          rules.map((row, i) =>
                            i === index
                              ? {
                                  ...row,
                                  values: e.target.value
                                    .split(',')
                                    .map((value) => value.trim())
                                    .filter(Boolean)
                                }
                              : row
                          )
                        )
                      }
                      placeholder="Answer values, separated by commas"
                    />
                  )}
                </div>
              </div>
            );
          })}
        </section>

        {inputType === 'single_choice' && (
          <section className="panel-card">
            <div className="panel-head">
              <div>
                <h2>Options and what each one reveals</h2>
                <p className="section-note">
                  The wording here is what the result page says about someone who picks that option.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() =>
                  setOptions((rows) => [
                    ...rows,
                    { value: '', label: '', outcome: { title: '', body: '', tone: 'developing' } }
                  ])
                }
              >
                <Plus size={13} /> Add option
              </button>
            </div>

            {options.map((option, index) => (
              <div className="disc-option-editor" key={index}>
                <div className="disc-option-editor-top">
                  <span className="disc-option-letter">{String.fromCharCode(65 + index)}</span>
                  <input
                    className="form-input"
                    value={option.label}
                    onChange={(e) => updateOption(index, { label: e.target.value })}
                    placeholder="Option as the person reads it"
                    aria-label={`Option ${index + 1} label`}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setOptions((rows) => rows.filter((_, i) => i !== index))}
                    aria-label={`Remove option ${index + 1}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>

                <div className="disc-option-outcome">
                  <span className="disc-option-outcome-title">If they pick this</span>
                  <select
                    className="form-select"
                    value={option.outcome?.tone || 'developing'}
                    onChange={(e) => updateOutcome(index, { tone: e.target.value as OutcomeCopy['tone'] })}
                    aria-label={`Option ${index + 1} tone`}
                  >
                    {TONE_OPTIONS.map((tone) => (
                      <option key={tone.value} value={tone.value}>
                        {tone.label}
                      </option>
                    ))}
                  </select>
                  <input
                    className="form-input"
                    value={option.outcome?.title || ''}
                    onChange={(e) => updateOutcome(index, { title: e.target.value })}
                    placeholder="Short heading, e.g. Size follows how confident you feel"
                    aria-label={`Option ${index + 1} result heading`}
                    maxLength={120}
                  />
                  <textarea
                    className="form-textarea"
                    rows={2}
                    value={option.outcome?.body || ''}
                    onChange={(e) => updateOutcome(index, { body: e.target.value })}
                    placeholder="One or two sentences we show in the result."
                    aria-label={`Option ${index + 1} result copy`}
                    maxLength={400}
                  />
                </div>
              </div>
            ))}
          </section>
        )}

        <section className="panel-card">
          <label className="check-row">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Keep this question active in the bank
          </label>
        </section>

        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/admin/discovery/questions')}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving...' : isNew ? 'Add question' : 'Save question'}
          </button>
        </div>
      </form>
    </div>
  );
};
