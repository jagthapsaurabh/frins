import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Copy, Download, Film, Link2, Loader2, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { PageHead } from '../../components/console/ConsoleUI';

interface VideoRow {
  id: string;
  video_id: string;
  url: string;
  title: string;
  channel: string | null;
  thumbnail: string | null;
  language: string | null;
  word_count: number;
  transcript_chars: number;
  transcript_source: 'YOUTUBE' | 'PASTED';
  course_id: string | null;
  created_by_name: string | null;
  created_at: string;
}

interface DraftModule {
  position: number;
  title: string;
  focus: string;
  lesson: string;
  task: {
    title: string;
    instructions: string;
    expectedCriteria: string;
    estimatedMinutes: number;
    dueDays: number;
  };
}

interface Draft {
  title: string;
  summary: string;
  description: string;
  track: string;
  level: string;
  generatedBy: 'LIVE_LLM' | 'DETERMINISTIC';
  modelName: string;
  modules: DraftModule[];
  tasks: number;
}

const TRACKS = [
  { value: 'student_concepts', label: 'Student · market concepts' },
  { value: 'strategy_learner', label: 'Strategy learner' },
  { value: 'trader', label: 'Active trader' },
  { value: 'investor', label: 'Long-term investor' },
  { value: 'both', label: 'All-round' }
];

const LEVELS = [
  { value: 'L1 · Foundations', label: 'L1 · Foundations' },
  { value: 'L1 to L2', label: 'L1 to L2' },
  { value: 'L2 · Guided', label: 'L2 · Guided' },
  { value: 'L2 to L3', label: 'L2 to L3' },
  { value: 'L3 · Independent', label: 'L3 · Independent' }
];

const formatDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

/**
 * Admin: paste a YouTube link, read or paste its transcript, and turn it into
 * a course with lessons and tasks. Nothing is saved until the admin says so.
 */
export const VideoStudioPage: React.FC = () => {
  const { authFetch } = useAuth();
  const navigate = useNavigate();

  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const [link, setLink] = useState('');
  const [pasted, setPasted] = useState('');
  const [needsTranscript, setNeedsTranscript] = useState(false);
  const [fetchNote, setFetchNote] = useState<string | null>(null);

  const [busy, setBusy] = useState<'fetch' | 'draft' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const [active, setActive] = useState<VideoRow | null>(null);
  const [transcript, setTranscript] = useState('');
  const [showTranscript, setShowTranscript] = useState(false);
  const [copied, setCopied] = useState(false);

  const [track, setTrack] = useState('trader');
  const [level, setLevel] = useState('L1 to L2');
  const [moduleCount, setModuleCount] = useState(4);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [savedCourseId, setSavedCourseId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VideoRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadVideos = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await authFetch('/api/admin/videos');
      if (res.ok) {
        const json = await res.json();
        setVideos(json.rows || []);
      }
    } catch {
      /* the list is not critical, the form still works */
    } finally {
      setLoadingList(false);
    }
  }, [authFetch]);

  useEffect(() => {
    loadVideos();
  }, [loadVideos]);

  /* ------------------------------------------------------------ add link */

  const addVideo = async (withTranscript: boolean) => {
    setError(null);
    setBanner(null);
    if (!link.trim()) {
      setError('Paste a YouTube link first.');
      return;
    }
    setBusy('fetch');
    try {
      const res = await authFetch('/api/admin/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: link.trim(), transcript: withTranscript ? pasted : '' })
      });
      const json = await res.json();

      if (!res.ok) {
        setError(json.error || 'Could not read that video.');
        if (json.needsTranscript) setNeedsTranscript(true);
        return;
      }

      setActive(json.video);
      setTranscript(json.video.transcript || '');
      setNeedsTranscript(false);
      setFetchNote(json.note || null);
      setBanner(
        json.video.transcript_source === 'YOUTUBE'
          ? 'Transcript pulled from YouTube.'
          : 'Transcript saved. Everything else works the same.'
      );
      setDraft(null);
      setSavedCourseId(null);
      setLink('');
      setPasted('');
      loadVideos();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
    }
  };

  const reopenVideo = async (row: VideoRow) => {
    setError(null);
    setBanner(null);
    setBusy('fetch');
    try {
      const res = await authFetch(`/api/admin/videos/${row.id}`);
      if (!res.ok) {
        setError('Could not open that video.');
        return;
      }
      const json = await res.json();
      setActive(json.video);
      setTranscript(json.video.transcript || '');
      setDraft(null);
      setSavedCourseId(json.video.course_id || null);
      setShowTranscript(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy(null);
    }
  };

  const removeVideo = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await authFetch(`/api/admin/videos/${deleteTarget.id}`, { method: 'DELETE' });
      if (res.ok) {
        setVideos((rows) => rows.filter((r) => r.id !== deleteTarget.id));
        if (active?.id === deleteTarget.id) {
          setActive(null);
          setDraft(null);
        }
      }
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  /* -------------------------------------------------------------- draft */

  const generate = async () => {
    if (!active) return;
    setBusy('draft');
    setError(null);
    setBanner(null);
    try {
      const res = await authFetch(`/api/admin/videos/${active.id}/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track, level, moduleCount })
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || 'Could not build a course from this transcript.');
        return;
      }
      setDraft(json.draft);
      setSavedCourseId(null);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
    }
  };

  const saveCourse = async () => {
    if (!active || !draft) return;
    setBusy('save');
    setError(null);
    try {
      const res = await authFetch(`/api/admin/videos/${active.id}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft })
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || 'Could not save the course.');
        return;
      }
      setSavedCourseId(json.courseId);
      setBanner(`Saved as a course with ${json.stepCount} steps. It is in Courses now.`);
      loadVideos();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
    }
  };

  const updateModule = (index: number, patch: Partial<DraftModule>) => {
    setDraft((current) => {
      if (!current) return current;
      const modules = current.modules.map((m, i) => (i === index ? { ...m, ...patch } : m));
      return { ...current, modules };
    });
  };

  const updateTask = (index: number, patch: Partial<DraftModule['task']>) => {
    setDraft((current) => {
      if (!current) return current;
      const modules = current.modules.map((m, i) =>
        i === index ? { ...m, task: { ...m.task, ...patch } } : m
      );
      return { ...current, modules };
    });
  };

  const copyTranscript = async () => {
    try {
      await navigator.clipboard.writeText(transcript);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('The browser blocked clipboard access. Select the text and copy it.');
    }
  };

  const downloadTranscript = () => {
    if (!active) return;
    const blob = new Blob([transcript], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${active.title.replace(/[^\w]+/g, '-').slice(0, 60)}-transcript.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalMinutes = useMemo(
    () =>
      (draft?.modules || []).reduce(
        (sum, m) => sum + 20 + (Number(m.task.estimatedMinutes) || 0),
        30
      ),
    [draft]
  );

  return (
    <div className="vs-page">
      <PageHead
        title="Video studio"
        meta="YouTube in, course out"
        actions={
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/admin/courses')}>
            All courses
          </button>
        }
      />

      {error && (
        <div className="vs-alert vs-alert-error" role="alert">
          {error}
        </div>
      )}
      {banner && (
        <div className="vs-alert vs-alert-ok" role="status">
          <Check size={14} /> {banner}
        </div>
      )}

      <div className="vs-grid">
        {/* ------------------------------------------------------- input */}
        <section className="vs-col">
          <div className="panel-card">
            <div className="panel-head">
              <h2>
                <Link2 size={14} /> Bring a video in
              </h2>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="vsLink">
                YouTube link
              </label>
              <input
                id="vsLink"
                className="form-input"
                placeholder="https://www.youtube.com/watch?v=..."
                value={link}
                onChange={(e) => setLink(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addVideo(needsTranscript);
                  }
                }}
              />
              <p className="form-hint">
                Watch, share, shorts and embed links all work. The title and channel come from YouTube.
              </p>
            </div>

            {needsTranscript && (
              <div className="vs-needs">
                <strong>Paste the transcript instead</strong>
                <p>
                  Open the video on YouTube, choose Show transcript under the description, and paste
                  everything here. Timestamps and caption markup are cleaned up automatically.
                </p>
                <textarea
                  className="form-textarea"
                  rows={6}
                  placeholder="Paste the whole transcript. It can be long."
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                />
              </div>
            )}

            <div className="vs-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => addVideo(needsTranscript)}
                disabled={busy !== null}
              >
                {busy === 'fetch' ? (
                  <>
                    <Loader2 size={14} className="vs-spin" /> Reading the video
                  </>
                ) : needsTranscript ? (
                  'Save this transcript'
                ) : (
                  'Get the transcript'
                )}
              </button>
              {needsTranscript && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setNeedsTranscript(false);
                    setPasted('');
                  }}
                >
                  Try another link
                </button>
              )}
            </div>
          </div>

          {active && (
            <div className="panel-card">
              <div className="panel-head">
                <h2>
                  <Film size={14} /> Transcript
                </h2>
                <span className={`vs-badge ${active.transcript_source === 'YOUTUBE' ? 'ok' : 'plain'}`}>
                  {active.transcript_source === 'YOUTUBE' ? 'From YouTube' : 'Pasted'}
                </span>
              </div>

              <div className="vs-video">
                {active.thumbnail ? (
                  <img src={active.thumbnail} alt="" />
                ) : (
                  <div className="vs-video-fallback" />
                )}
                <div>
                  <strong>{active.title}</strong>
                  <span>
                    {active.channel || 'YouTube'}
                    {active.language ? ` · ${active.language}` : ''}
                  </span>
                  <span>{active.word_count.toLocaleString('en-IN')} words</span>
                </div>
              </div>

              <div className="vs-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowTranscript((v) => !v)}
                >
                  {showTranscript ? 'Hide the text' : 'Read the transcript'}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={copyTranscript}>
                  {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={downloadTranscript}>
                  <Download size={13} /> Download
                </button>
              </div>

              {showTranscript && <pre className="vs-transcript">{transcript}</pre>}

              {fetchNote && <p className="form-hint">{fetchNote}</p>}
            </div>
          )}
        </section>

        {/* ------------------------------------------------------- draft */}
        <section className="vs-col">
          <div className="panel-card">
            <div className="panel-head">
              <h2>
                <Wand2 size={14} /> Build a course
              </h2>
            </div>

            {!active ? (
              <div className="empty-state">
                <strong>Nothing to build yet</strong>
                Add a video on the left and its transcript lands here.
              </div>
            ) : (
              <>
                <div className="vs-settings">
                  <div className="form-group">
                    <label className="form-label" htmlFor="vsTrack">
                      Track
                    </label>
                    <select
                      id="vsTrack"
                      className="form-select"
                      value={track}
                      onChange={(e) => setTrack(e.target.value)}
                    >
                      {TRACKS.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="vsLevel">
                      Level
                    </label>
                    <select
                      id="vsLevel"
                      className="form-select"
                      value={level}
                      onChange={(e) => setLevel(e.target.value)}
                    >
                      {LEVELS.map((l) => (
                        <option key={l.value} value={l.value}>
                          {l.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="vsModules">
                      Modules
                    </label>
                    <select
                      id="vsModules"
                      className="form-select"
                      value={String(moduleCount)}
                      onChange={(e) => setModuleCount(Number(e.target.value))}
                    >
                      {[2, 3, 4, 5, 6, 8].map((n) => (
                        <option key={n} value={n}>
                          {n} modules
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="vs-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={generate}
                    disabled={busy !== null}
                  >
                    {busy === 'draft' ? (
                      <>
                        <Loader2 size={14} className="vs-spin" /> Writing the course
                      </>
                    ) : (
                      <>
                        <Sparkles size={14} /> {draft ? 'Write it again' : 'Generate the course'}
                      </>
                    )}
                  </button>
                </div>

                <p className="form-hint">
                  A draft is written first. Nothing is published until you save, and every field stays
                  editable.
                </p>
              </>
            )}
          </div>

          {draft && (
            <div className="panel-card">
              <div className="panel-head">
                <h2>Draft</h2>
                <span className={`vs-badge ${draft.generatedBy === 'LIVE_LLM' ? 'ok' : 'plain'}`}>
                  {draft.generatedBy === 'LIVE_LLM' ? `Model: ${draft.modelName}` : 'Built from the transcript'}
                </span>
              </div>

              <div className="vs-draft-meta">
                <input
                  className="form-input vs-title-input"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  aria-label="Course title"
                />
                <span>
                  {draft.modules.length} modules · {draft.modules.length} tasks · about{' '}
                  {Math.round(totalMinutes / 60)} hours
                </span>
              </div>

              <div className="vs-modules">
                {draft.modules.map((module, index) => (
                  <details className="vs-module" key={module.position} open={index === 0}>
                    <summary>
                      <span className="vs-module-num">{String(module.position).padStart(2, '0')}</span>
                      <span className="vs-module-title">{module.title}</span>
                      <span className="vs-module-tasks">1 task</span>
                    </summary>

                    <div className="vs-module-body">
                      <label className="form-label">Module title</label>
                      <input
                        className="form-input"
                        value={module.title}
                        onChange={(e) => updateModule(index, { title: e.target.value })}
                      />

                      <label className="form-label vs-gap">Lesson text</label>
                      <textarea
                        className="form-textarea"
                        rows={6}
                        value={module.lesson}
                        onChange={(e) => updateModule(index, { lesson: e.target.value })}
                      />

                      <div className="vs-task">
                        <span className="vs-task-label">Task</span>
                        <input
                          className="form-input"
                          value={module.task.title}
                          onChange={(e) => updateTask(index, { title: e.target.value })}
                          aria-label="Task title"
                        />
                        <textarea
                          className="form-textarea"
                          rows={5}
                          value={module.task.instructions}
                          onChange={(e) => updateTask(index, { instructions: e.target.value })}
                          aria-label="Task instructions"
                        />
                        <label className="form-label vs-gap">What the reviewer checks</label>
                        <textarea
                          className="form-textarea"
                          rows={4}
                          value={module.task.expectedCriteria}
                          onChange={(e) => updateTask(index, { expectedCriteria: e.target.value })}
                        />
                        <div className="vs-task-row">
                          <label>
                            Minutes
                            <input
                              className="form-input"
                              type="number"
                              min={5}
                              max={240}
                              value={module.task.estimatedMinutes}
                              onChange={(e) =>
                                updateTask(index, { estimatedMinutes: Number(e.target.value) })
                              }
                            />
                          </label>
                          <label>
                            Due in days
                            <input
                              className="form-input"
                              type="number"
                              min={1}
                              max={60}
                              value={module.task.dueDays}
                              onChange={(e) => updateTask(index, { dueDays: Number(e.target.value) })}
                            />
                          </label>
                        </div>
                      </div>
                    </div>
                  </details>
                ))}
              </div>

              <div className="vs-actions vs-actions-end">
                {savedCourseId ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => navigate(`/admin/courses/${savedCourseId}`)}
                  >
                    Open the course
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary" onClick={saveCourse} disabled={busy !== null}>
                    {busy === 'save' ? (
                      <>
                        <Loader2 size={14} className="vs-spin" /> Saving
                      </>
                    ) : (
                      'Save as a course'
                    )}
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* --------------------------------------------------------- list */}
      <div className="panel-card vs-library">
        <div className="panel-head">
          <h2>Videos in the studio</h2>
          <span className="panel-count">{videos.length}</span>
        </div>

        {loadingList ? (
          <p className="table-empty">Loading...</p>
        ) : videos.length === 0 ? (
          <div className="empty-state">
            <strong>No videos yet</strong>
            The first transcript you add stays here, so you can build another course from it later.
          </div>
        ) : (
          <div className="vs-list">
            {videos.map((row) => (
              <div className="vs-list-row" key={row.id}>
                <div className="vs-list-main">
                  <strong>{row.title}</strong>
                  <span>
                    {row.channel || 'YouTube'} · {row.word_count.toLocaleString('en-IN')} words ·{' '}
                    {formatDate(row.created_at)}
                    {row.transcript_source === 'PASTED' ? ' · pasted transcript' : ''}
                  </span>
                </div>
                <div className="vs-list-actions">
                  {row.course_id && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => navigate(`/admin/courses/${row.course_id}`)}
                    >
                      Course
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => reopenVideo(row)}
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    className="btn btn-icon"
                    aria-label={`Remove ${row.title}`}
                    onClick={() => setDeleteTarget(row)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Remove this video?"
        message={
          deleteTarget
            ? `"${deleteTarget.title}" and its transcript will be removed. Courses already built from it stay where they are.`
            : ''
        }
        confirmLabel="Remove"
        variant="danger"
        busy={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={removeVideo}
      />
    </div>
  );
};
