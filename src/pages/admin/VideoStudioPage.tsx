import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  Check,
  Copy,
  Download,
  FileText,
  Film,
  Link2,
  ListVideo,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
  Wand2
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { PageHead } from '../../components/console/ConsoleUI';

interface SummarySection {
  startSeconds: number;
  timestamp: string;
  title: string;
  points: string[];
}

interface VideoSummary {
  overview: string;
  sections: SummarySection[];
  takeaways: string[];
  basis: 'TRANSCRIPT' | 'CHAPTERS' | 'DESCRIPTION' | 'METADATA';
  generatedBy: 'LIVE_LLM' | 'DETERMINISTIC';
  modelName: string;
  durationSeconds: number | null;
  readingMinutes: number;
  fallbackReason?: string;
  /** Why there is nothing to read, in the server's own words. */
  note?: string;
}

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
  description_chars?: number;
  transcript_source: 'YOUTUBE' | 'PASTED' | 'NONE';
  course_id: string | null;
  created_by_name: string | null;
  created_at: string;
  description?: string | null;
  duration_seconds?: number | null;
  chapters?: Array<{ startSeconds: number; title: string }>;
  summary?: VideoSummary | null;
  summary_text?: string | null;
  has_summary?: number;
  has_chapters?: number;
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
  basis?: 'TRANSCRIPT' | 'DESCRIPTION' | 'TOPIC';
  fallbackReason?: string;
  modules: DraftModule[];
  tasks: number;
}

interface LearnerRow {
  id: string;
  name: string;
  track: string;
}

interface AiInfo {
  label: string;
  model: string;
  free: boolean;
  available: boolean;
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

const basisLabel = (basis?: string) =>
  basis === 'TOPIC' ? 'From the topic' : basis === 'DESCRIPTION' ? 'From the description' : 'From the transcript';

/** 1 hr 12 min, or 18 min. */
const fmtDuration = (seconds?: number | null) => {
  const total = Math.round(Number(seconds) || 0);
  if (total < 60) return '';
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  if (hours > 0) return `${hours} hr ${minutes} min`;
  return `${minutes} min`;
};

/** Why a page read came back empty, said the way a person would say it. */
const readTrouble = (status?: string) => {
  if (status === 'UNAVAILABLE') {
    return {
      title: 'YouTube says this video is unavailable',
      body: 'It may be private, taken down, or the link may be short of a character. Check it in a browser first.'
    };
  }
  if (status === 'BOT_WALL') {
    return {
      title: 'YouTube asked for a browser, not a server',
      body: 'It wanted to confirm a person was asking, so it sent nothing back. Try again in a minute, or paste the transcript.'
    };
  }
  return {
    title: "We could not read this video's page",
    body: 'YouTube sent nothing back for the link, which is usually a passing block on their side. Try again in a minute.'
  };
};

const summaryBasisLabel = (basis?: string) =>
  basis === 'TRANSCRIPT'
    ? 'From the captions'
    : basis === 'CHAPTERS'
      ? "From the creator's chapters"
      : basis === 'METADATA'
        ? 'Title and length only'
        : 'From the description only';

/** A long video gets the two minute promise. A short one does not need it. */
const readEstimate = (seconds?: number | null) =>
  Number(seconds) >= 45 * 60 ? 'about 2 minutes to read' : 'a short read';

/** Clicking a time opens the video at that minute. */
const jumpUrl = (videoId: string, startSeconds: number) =>
  `https://youtu.be/${videoId}?t=${Math.max(0, Math.round(Number(startSeconds) || 0))}`;

/** The summary as a markdown file, for a note or a message. */
const summaryMarkdown = (summary: VideoSummary, title: string, videoId: string) => {
  const lines: string[] = [
    `# ${title}`,
    '',
    `https://www.youtube.com/watch?v=${videoId}`,
    '',
    `_${summaryBasisLabel(summary.basis)} · ${summary.readingMinutes} min read_`,
    '',
    summary.overview
  ];
  if (summary.sections.length) {
    lines.push('', '## Sections');
    for (const section of summary.sections) {
      lines.push('', `### [${section.timestamp}](${jumpUrl(videoId, section.startSeconds)}) ${section.title}`);
      for (const point of section.points) lines.push(`- ${point}`);
    }
  }
  if (summary.takeaways.length) {
    lines.push('', '## Takeaways');
    for (const takeaway of summary.takeaways) lines.push(`- ${takeaway}`);
  }
  return lines.join('\n');
};

/**
 * Admin: bring a video in, or describe a topic, and turn either into a course
 * with lessons and tasks. Nothing is saved until the admin says so.
 */
export const VideoStudioPage: React.FC = () => {
  const { authFetch } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<'video' | 'topic'>('video');

  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  /* ------------------------------------------------------------ video mode */
  const [link, setLink] = useState('');
  const [pasted, setPasted] = useState('');
  const [needsTranscript, setNeedsTranscript] = useState(false);
  const [canUseDescription, setCanUseDescription] = useState(false);
  const [canSummarise, setCanSummarise] = useState(false);
  const [probe, setProbe] = useState<{
    durationSeconds: number | null;
    chapterCount: number;
    pageRead?: string;
    captionLanguages?: string[];
  } | null>(null);
  const [fetchNote, setFetchNote] = useState<string | null>(null);
  const [summaryCopied, setSummaryCopied] = useState(false);

  const [busy, setBusy] = useState<'fetch' | 'draft' | 'save' | 'plan' | 'summary' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const [active, setActive] = useState<VideoRow | null>(null);
  const [transcript, setTranscript] = useState('');
  const [showTranscript, setShowTranscript] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [latePaste, setLatePaste] = useState('');

  /* ------------------------------------------------------------ topic mode */
  const [topic, setTopic] = useState('');
  const [brief, setBrief] = useState('');
  const [learners, setLearners] = useState<LearnerRow[]>([]);
  const [learnerId, setLearnerId] = useState('');
  const [ai, setAi] = useState<AiInfo | null>(null);

  /* ----------------------------------------------------------------- shared */
  const [track, setTrack] = useState('trader');
  const [level, setLevel] = useState('L1 to L2');
  const [moduleCount, setModuleCount] = useState(4);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftOrigin, setDraftOrigin] = useState<'video' | 'topic'>('video');
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
    } finally {
      setLoadingList(false);
    }
  }, [authFetch]);

  useEffect(() => {
    loadVideos();
  }, [loadVideos]);

  useEffect(() => {
    authFetch('/api/admin/course-studio/ai')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.ai) setAi(json.ai);
      })
      .catch(() => undefined);
  }, [authFetch]);

  useEffect(() => {
    if (mode !== 'topic' || learners.length) return;
    authFetch('/api/admin/learners?limit=200')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => setLearners(json?.rows || []))
      .catch(() => undefined);
  }, [authFetch, mode, learners.length]);

  /* ------------------------------------------------------------- video flow */

  const addVideo = async (withTranscript: boolean, acceptDescription = false, summaryOnly = false) => {
    setError(null);
    setBanner(null);
    if (!link.trim()) {
      setError('Paste a YouTube link first.');
      return;
    }
    setBusy('fetch');
    let summariseAfter: string | null = null;
    try {
      const res = await authFetch('/api/admin/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: link.trim(),
          transcript: withTranscript ? pasted : '',
          acceptDescription,
          summaryOnly
        })
      });
      const json = await res.json();

      if (!res.ok) {
        setError(json.error || 'Could not read that video.');
        if (json.needsTranscript) setNeedsTranscript(true);
        setCanUseDescription(Boolean(json.canUseDescription));
        setCanSummarise(Boolean(json.canSummarise));
        setProbe(
          json.canSummarise || json.pageRead
            ? {
                durationSeconds: json.durationSeconds ?? null,
                chapterCount: Number(json.chapterCount) || 0,
                pageRead: json.pageRead,
                captionLanguages: json.captionLanguages
              }
            : null
        );
        return;
      }

      setActive(json.video);
      setTranscript(json.video.transcript || '');
      setNeedsTranscript(false);
      setCanUseDescription(false);
      setCanSummarise(false);
      setProbe(null);
      setFetchNote(json.note || null);
      setBanner(
        json.video.transcript_source === 'YOUTUBE'
          ? 'Transcript pulled from YouTube.'
          : json.video.transcript
            ? 'Transcript saved. Everything else works the same.'
            : summaryOnly
              ? 'Saved. Reading the video now.'
              : 'Saved. The course will be written from the video description.'
      );
      setDraft(null);
      setDraftOrigin('video');
      setSavedCourseId(null);
      setLink('');
      setPasted('');
      setPasteOpen(false);
      loadVideos();
      if (summaryOnly) summariseAfter = json.video.id;
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
    }
    if (summariseAfter) generateSummary(summariseAfter);
  };

  const reopenVideo = async (row: VideoRow) => {
    setError(null);
    setBanner(null);
    setBusy('fetch');
    try {
      const res = await authFetch(`/api/admin/videos/${row.id}`);
      if (!res.ok) {
        setError('That video is no longer in the studio.');
        return;
      }
      const json = await res.json();
      setMode('video');
      setActive(json.video);
      setTranscript(json.video.transcript || '');
      setFetchNote(null);
      setNeedsTranscript(false);
      setCanUseDescription(false);
      setCanSummarise(false);
      setProbe(null);
      setDraft(null);
      setDraftOrigin('video');
      setSavedCourseId(json.video.course_id || null);
      setPasteOpen(false);
      setLatePaste('');
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
    }
  };

  const attachTranscript = async () => {
    if (!active) return;
    setError(null);
    setBanner(null);
    setBusy('fetch');
    try {
      const res = await authFetch(`/api/admin/videos/${active.id}/transcript`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: latePaste })
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Could not save that transcript.');
        return;
      }
      setActive(json.video);
      setTranscript(json.video.transcript || '');
      setLatePaste('');
      setPasteOpen(false);
      setBanner('Transcript added. Generate the course again and it will use the words from the video.');
      loadVideos();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
    }
  };

  const removeVideo = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await authFetch(`/api/admin/videos/${deleteTarget.id}`, { method: 'DELETE' });
      if (active?.id === deleteTarget.id) {
        setActive(null);
        setDraft(null);
        setTranscript('');
      }
      setDeleteTarget(null);
      loadVideos();
    } finally {
      setDeleting(false);
    }
  };

  /* ------------------------------------------------------------- shared AI */

  const generateFromVideo = async () => {
    if (!active) return;
    setError(null);
    setBanner(null);
    setBusy('draft');
    try {
      const res = await authFetch(`/api/admin/videos/${active.id}/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track, level, moduleCount, learnerId: learnerId || undefined })
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Could not write the draft.');
        return;
      }
      setDraft(json.draft);
      setDraftOrigin('video');
      setSavedCourseId(null);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
    }
  };

  const generateFromTopic = async () => {
    setError(null);
    setBanner(null);
    if (topic.trim().length < 3) {
      setError('Write the topic first. A few words is enough.');
      return;
    }
    setBusy('plan');
    try {
      const res = await authFetch('/api/admin/course-studio/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topic.trim(),
          brief: brief.trim(),
          track,
          level,
          moduleCount,
          learnerId: learnerId || undefined
        })
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Could not write the course.');
        return;
      }
      setDraft(json.draft);
      setDraftOrigin('topic');
      setSavedCourseId(null);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
    }
  };

  const saveCourse = async () => {
    if (!draft) return;
    setError(null);
    setBanner(null);
    setBusy('save');
    try {
      const endpoint =
        draftOrigin === 'topic'
          ? '/api/admin/course-studio/save'
          : `/api/admin/videos/${active?.id}/save`;
      const body =
        draftOrigin === 'topic'
          ? { draft, learnerId: learnerId || undefined }
          : { draft };

      const res = await authFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Could not save the course.');
        return;
      }
      setSavedCourseId(json.courseId);
      setBanner(
        json.assignedTo
          ? `Saved as a course and assigned to ${json.assignedTo}.`
          : `Saved as a course with ${json.stepCount} steps.`
      );
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
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const downloadTranscript = () => {
    if (!transcript) return;
    const blob = new Blob([transcript], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(active?.title || 'transcript').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /* --------------------------------------------------------- the summary */

  /**
   * A two hour video becomes a short read with the time each part starts. The
   * server decides what it can trust: captions, the creator's chapters, or the
   * description. It never makes a timestamp up.
   */
  const generateSummary = async (videoId?: string, refresh = false) => {
    const id = videoId || active?.id;
    if (!id) return;
    setError(null);
    setBanner(null);
    setSummaryCopied(false);
    setBusy('summary');
    try {
      const res = await authFetch(`/api/admin/videos/${id}/summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh })
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Could not summarise that video.');
        return;
      }
      if (json.video) setActive(json.video);
      const made: VideoSummary = json.summary;
      setBanner(
        made.sections.length > 0
          ? `Summary ready. ${made.sections.length} jump points${made.durationSeconds ? ` across ${fmtDuration(made.durationSeconds)}` : ''}, about ${made.readingMinutes} min to read.`
          : 'Summary ready. It is short because the video gave us only its description.'
      );
      loadVideos();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
    }
  };

  const copySummary = async () => {
    if (!active?.summary_text) return;
    try {
      await navigator.clipboard.writeText(active.summary_text);
      setSummaryCopied(true);
      setTimeout(() => setSummaryCopied(false), 1600);
    } catch {
      setSummaryCopied(false);
    }
  };

  const downloadSummary = () => {
    if (!active?.summary) return;
    const markdown = summaryMarkdown(active.summary, active.title, active.video_id);
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${active.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-summary.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalMinutes = useMemo(
    () => (draft?.modules || []).reduce((sum, m) => sum + (Number(m.task?.estimatedMinutes) || 0), 0),
    [draft]
  );

  const aiLine = ai?.available
    ? ai.free
      ? `Written by the free model (${ai.model}). No key needed.`
      : `Written by ${ai.label} (${ai.model}).`
    : 'No model connected. Drafts come from the built-in writer.';

  const learnerName = learners.find((l) => l.id === learnerId)?.name;
  const activeSummary = active?.summary || null;

  return (
    <div className="vs-page">
      <PageHead
        title="Course studio"
        meta="A video, or a topic"
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

      <div className="vs-mode">
        <button
          type="button"
          className={`vs-mode-tab ${mode === 'video' ? 'on' : ''}`}
          onClick={() => setMode('video')}
        >
          <Film size={14} /> From a video
        </button>
        <button
          type="button"
          className={`vs-mode-tab ${mode === 'topic' ? 'on' : ''}`}
          onClick={() => setMode('topic')}
        >
          <FileText size={14} /> From a topic
        </button>
        <span className="vs-mode-note">{aiLine}</span>
      </div>

      <div className="vs-grid">
        {/* ------------------------------------------------------- input */}
        <section className="vs-col">
          {mode === 'video' ? (
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
                  Any YouTube video, watch, share, shorts or embed. A summary needs no transcript, so
                  paste the link and press summarise.
                </p>
              </div>

              {needsTranscript && (
                <div className="vs-needs">
                  {probe?.pageRead && probe.pageRead !== 'OK' ? (
                    <>
                      <strong>{readTrouble(probe.pageRead).title}</strong>
                      <p>{readTrouble(probe.pageRead).body}</p>
                    </>
                  ) : (
                    <>
                      <strong>YouTube held the captions back</strong>
                      <p>
                        A summary does not need them, so that is the quicker way through.{' '}
                        {canSummarise
                          ? 'A course can also be written from the description and the chapter list.'
                          : 'A course needs words, so paste the transcript from the video page.'}
                      </p>
                      {probe?.captionLanguages && probe.captionLanguages.length > 0 && (
                        <p className="vs-needs-fact">
                          Captions exist in {probe.captionLanguages.join(', ')}. YouTube keeps the words
                          from servers, so copy them from the video's transcript panel.
                        </p>
                      )}
                    </>
                  )}

                  {canSummarise && probe && (
                    <p className="vs-needs-fact">
                      {[fmtDuration(probe.durationSeconds), probe.chapterCount > 0 ? `${probe.chapterCount} chapters` : '']
                        .filter(Boolean)
                        .join(' · ') || 'Enough here to summarise'}
                      {probe.durationSeconds ? ` · ${readEstimate(probe.durationSeconds)}` : ''}
                    </p>
                  )}

                  <div className="vs-actions vs-actions-top">
                    {canSummarise && (
                      <button
                        type="button"
                        className={`btn ${pasted.trim() ? 'btn-secondary' : 'btn-primary'}`}
                        onClick={() => addVideo(false, false, true)}
                        disabled={busy !== null}
                      >
                        {busy === 'fetch' ? (
                          <>
                            <Loader2 size={14} className="vs-spin" /> Reading the video
                          </>
                        ) : (
                          <>
                            <Sparkles size={13} /> Just summarise the video
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  <textarea
                    className="form-textarea"
                    rows={6}
                    placeholder="Paste the whole transcript. It can be long."
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                  />

                  <div className="vs-actions">
                    <button
                      type="button"
                      className={`btn ${pasted.trim() ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => addVideo(true)}
                      disabled={busy !== null || !pasted.trim()}
                    >
                      Save this transcript
                    </button>
                    {canUseDescription && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => addVideo(false, true)}
                        disabled={busy !== null}
                      >
                        Use the description instead
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="vs-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => addVideo(false, false, true)}
                  disabled={busy !== null}
                >
                  {busy === 'fetch' || busy === 'summary' ? (
                    <>
                      <Loader2 size={14} className="vs-spin" /> Reading the video
                    </>
                  ) : (
                    <>
                      <Sparkles size={13} /> Summarise this video
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => addVideo(needsTranscript)}
                  disabled={busy !== null}
                >
                  Build a course instead
                </button>
              </div>
            </div>
          ) : (
            <div className="panel-card">
              <div className="panel-head">
                <h2>
                  <FileText size={14} /> Start from a topic
                </h2>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="vsTopic">
                  Topic
                </label>
                <input
                  id="vsTopic"
                  className="form-input"
                  placeholder="e.g. Position sizing from the stop, not from lot size"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  maxLength={180}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="vsBrief">
                  What has to be in it <span className="vs-optional">Optional</span>
                </label>
                <textarea
                  id="vsBrief"
                  className="form-textarea"
                  rows={5}
                  placeholder="Anything the course has to cover, or a mistake the learner keeps making. The more specific this is, the less generic the course."
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  maxLength={4000}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="vsLearner">
                  Write it for <span className="vs-optional">Optional</span>
                </label>
                <select
                  id="vsLearner"
                  className="form-select"
                  value={learnerId}
                  onChange={(e) => setLearnerId(e.target.value)}
                >
                  <option value="">Anyone on this track</option>
                  {learners.map((learner) => (
                    <option key={learner.id} value={learner.id}>
                      {learner.name} · {learner.track}
                    </option>
                  ))}
                </select>
                <p className="form-hint">
                  {learnerName
                    ? `The course will use ${learnerName}'s level and the focus areas from their Discovery review. Saving assigns it to them.`
                    : 'Pick a learner and the course is written around them, then assigned on save.'}
                </p>
              </div>
            </div>
          )}

          {mode === 'video' && active && (
            <div className="panel-card">
              <div className="panel-head">
                <h2>
                  <Film size={14} /> Source
                </h2>
                <span className={`vs-badge ${active.transcript_source === 'YOUTUBE' ? 'ok' : 'plain'}`}>
                  {transcript
                    ? active.transcript_source === 'YOUTUBE'
                      ? 'From YouTube'
                      : 'Pasted'
                    : active.transcript_source === 'NONE'
                      ? 'Summary only'
                      : 'Description only'}
                </span>
              </div>

              <div className="vs-video">
                {active.thumbnail ? <img src={active.thumbnail} alt="" /> : <div className="vs-video-fallback" />}
                <div>
                  <strong>{active.title}</strong>
                  <span>
                    {active.channel || 'YouTube'}
                    {active.language ? ` · ${active.language}` : ''}
                  </span>
                  <span>
                    {transcript
                      ? `${active.word_count.toLocaleString('en-IN')} words`
                      : active.transcript_source === 'NONE'
                        ? 'The words stayed with YouTube. The summary is built from what the creator published.'
                        : 'The words stayed with YouTube. A course can still be written from the description.'}
                  </span>
                </div>
              </div>

              {transcript ? (
                <>
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
                </>
              ) : (
                <>
                  <p className="form-hint">
                    Paste the transcript from the video page any time. The course gets sharper when the
                    model reads the actual words.
                  </p>
                  {pasteOpen ? (
                    <div className="vs-needs">
                      <textarea
                        className="form-textarea"
                        rows={6}
                        placeholder="Paste the transcript here."
                        value={latePaste}
                        onChange={(e) => setLatePaste(e.target.value)}
                      />
                      <div className="vs-actions">
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={attachTranscript}
                          disabled={busy !== null || !latePaste.trim()}
                        >
                          Save the transcript
                        </button>
                        <button type="button" className="btn btn-ghost" onClick={() => setPasteOpen(false)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPasteOpen(true)}>
                      Add the transcript
                    </button>
                  )}
                </>
              )}

              {fetchNote && <p className="form-hint">{fetchNote}</p>}
            </div>
          )}
        </section>

        {/* ----------------------------------------------------- summary */}
        <section className="vs-col">
          {mode === 'video' && active && (
            <div className="panel-card vs-summary-card">
              <div className="panel-head">
                <h2>
                  <ListVideo size={14} /> Summary
                </h2>
                {activeSummary && (
                  <span className={`vs-badge ${activeSummary.basis === 'TRANSCRIPT' ? 'ok' : 'plain'}`}>
                    {summaryBasisLabel(activeSummary.basis)}
                  </span>
                )}
              </div>

              {!activeSummary ? (
                <div className="vs-summary-pitch">
                  {busy === 'summary' ? (
                    <>
                      <strong>Reading the video.</strong>
                      <p>
                        Captions first, then the creator's chapters, then the description. Up to a
                        minute on the free model.
                      </p>
                      <div className="vs-summary-progress" aria-hidden="true" />
                    </>
                  ) : (
                    <>
                      <strong>
                        {active.duration_seconds
                          ? `${fmtDuration(active.duration_seconds)} of video, ${readEstimate(active.duration_seconds)}.`
                          : 'The whole video, in a short read.'}
                      </strong>
                      <p>
                        No need to sit through all of it. You get what the video covers, the time each
                        part starts, and the few points worth keeping. Click a time to open the video
                        at that minute.
                      </p>
                      {(active.chapters?.length || 0) > 0 && (
                        <p className="vs-summary-fact">
                          {active.chapters?.length} chapters found on the video, so the jump points
                          will be real.
                        </p>
                      )}
                      <div className="vs-actions">
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => generateSummary()}
                          disabled={busy !== null}
                        >
                          <Sparkles size={13} /> Summarise this video
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <>
                  {activeSummary.fallbackReason && (
                    <div className="vs-alert vs-alert-warn" role="status">
                      The model did not answer, so this is the built-in summary. {activeSummary.fallbackReason}
                    </div>
                  )}

                  <div className="vs-summary-meta">
                    <span>{activeSummary.readingMinutes} min read</span>
                    {fmtDuration(active.duration_seconds) ? (
                      <span>{fmtDuration(active.duration_seconds)} video</span>
                    ) : null}
                    {activeSummary.sections.length > 0 ? (
                      <span>{activeSummary.sections.length} jump points</span>
                    ) : null}
                    {activeSummary.generatedBy === 'LIVE_LLM' ? (
                      <span className="vs-summary-model">{activeSummary.modelName}</span>
                    ) : null}
                  </div>

                  <p className="vs-summary-overview">{activeSummary.overview}</p>

                  {activeSummary.sections.length > 0 && (
                    <>
                      <div className="vs-summary-label">Jump to</div>
                      <ol className="vs-jumps">
                        {activeSummary.sections.map((section) => (
                          <li className="vs-jump" key={`${section.startSeconds}-${section.title}`}>
                            <a
                              className="vs-jump-time"
                              href={jumpUrl(active.video_id, section.startSeconds)}
                              target="_blank"
                              rel="noreferrer"
                              title={`Open the video at ${section.timestamp}`}
                            >
                              {section.timestamp}
                              <ArrowUpRight size={9} />
                            </a>
                            <div className="vs-jump-body">
                              <span className="vs-jump-title">{section.title}</span>
                              {section.points.length > 0 && (
                                <ul className="vs-jump-points">
                                  {section.points.map((point, index) => (
                                    <li key={index}>{point}</li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </li>
                        ))}
                      </ol>
                    </>
                  )}

                  {activeSummary.takeaways.length > 0 && (
                    <>
                      <div className="vs-summary-label">Keep these</div>
                      <ul className="vs-takeaways">
                        {activeSummary.takeaways.map((takeaway, index) => (
                          <li key={index}>{takeaway}</li>
                        ))}
                      </ul>
                    </>
                  )}

                  {activeSummary.basis === 'DESCRIPTION' && (
                    <p className="vs-summary-fine">
                      Built from the description. YouTube kept the captions back and the creator wrote
                      no chapter marks, so there are no times to point at. Paste the transcript and
                      rewrite it for real jump points.
                    </p>
                  )}

                  {activeSummary.basis === 'METADATA' && (
                    <p className="vs-summary-fine">
                      {activeSummary.note ||
                        'There is nothing to read for this one yet. Paste the transcript and the summary fills in with the time each part starts.'}
                    </p>
                  )}

                  {activeSummary.basis === 'CHAPTERS' && (
                    <p className="vs-summary-fine">
                      Built from the creator's chapter list and the description. The times are the
                      creator's own, so each one lands where they meant it to.
                    </p>
                  )}

                  <div className="vs-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={copySummary}>
                      {summaryCopied ? <Check size={13} /> : <Copy size={13} />}{' '}
                      {summaryCopied ? 'Copied' : 'Copy'}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={downloadSummary}>
                      <Download size={13} /> Download .md
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => generateSummary(undefined, true)}
                      disabled={busy !== null}
                    >
                      {busy === 'summary' ? (
                        <>
                          <Loader2 size={13} className="vs-spin" /> Reading again
                        </>
                      ) : (
                        <>
                          <RefreshCw size={13} />{' '}
                          {activeSummary.basis === 'METADATA' ? 'Try again' : 'Rewrite'}
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="panel-card">
            <div className="panel-head">
              <h2>
                <Wand2 size={14} /> Build a course
              </h2>
            </div>

            {mode === 'video' && !active ? (
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
                    <select id="vsTrack" className="form-select" value={track} onChange={(e) => setTrack(e.target.value)}>
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
                    <select id="vsLevel" className="form-select" value={level} onChange={(e) => setLevel(e.target.value)}>
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
                    onClick={mode === 'topic' ? generateFromTopic : generateFromVideo}
                    disabled={busy !== null}
                  >
                    {busy === 'draft' || busy === 'plan' ? (
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
                  {draft.generatedBy === 'LIVE_LLM'
                    ? `Model: ${draft.modelName}`
                    : draft.basis === 'TOPIC'
                      ? 'Outline only'
                      : 'Built from the transcript'}
                </span>
              </div>

              <p className="vs-basis">{basisLabel(draft.basis)}</p>

              {draft.fallbackReason && (
                <div className="vs-alert vs-alert-warn" role="status">
                  {draft.fallbackReason} This draft came from the built in writer instead. Try again, or
                  add your own key in Settings, AI engine.
                </div>
              )}

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
                              onChange={(e) => updateTask(index, { estimatedMinutes: Number(e.target.value) })}
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
                    ) : draftOrigin === 'topic' && learnerId ? (
                      `Save and assign to ${learnerName || 'the learner'}`
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
            The first video you add stays here, with its summary, so you can come back to it later.
          </div>
        ) : (
          <div className="vs-list">
            {videos.map((row) => (
              <div className="vs-list-row" key={row.id}>
                <div className="vs-list-main">
                  <strong>
                    {row.title}
                    {row.has_summary ? <span className="vs-badge ok vs-list-badge">Summary</span> : null}
                  </strong>
                  <span>
                    {row.channel || 'YouTube'} ·{' '}
                    {row.word_count > 0
                      ? `${row.word_count.toLocaleString('en-IN')} words`
                      : row.has_summary
                        ? 'summary only'
                        : 'description only'}
                    {row.duration_seconds ? ` · ${fmtDuration(row.duration_seconds)}` : ''} ·{' '}
                    {formatDate(row.created_at)}
                    {row.transcript_source === 'PASTED' && row.word_count > 0 ? ' · pasted transcript' : ''}
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
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => reopenVideo(row)}>
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
