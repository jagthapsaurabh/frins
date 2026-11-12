import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  Users,
  CalendarCheck,
  ClipboardList,
  BookOpen,
  GraduationCap,
  HelpCircle,
  LayoutDashboard,
  UserCog,
  Contact,
  BellRing,
  Settings as SettingsIcon,
  KeyRound,
  Plus
} from 'lucide-react';
import { StaffSignInGate } from '../components/StaffSignInGate';
import { GuideWorkspacePage } from './GuideWorkspacePage';
import { LearnersDirectory } from './admin/LearnersDirectory';
import { formatDateTime } from '../utils/dates';
import { AdminNotifications } from './admin/AdminNotifications';
import { LearnerProgress } from './admin/LearnerProgress';
import { Pager } from '../components/Pager';
import { usePagedList } from '../hooks/usePagedList';
import { ADMIN_SECTIONS, adminKeyFromPath, findAdminSection, type AdminSectionKey } from './adminSections';

const BOOKING_STATUSES = [
  'REQUESTED',
  'NEW',
  'DIRECT_CALL_BOOKED',
  'CONFIRMED',
  'RESCHEDULED',
  'COMPLETED',
  'NO_SHOW',
  'CANCELLED'
];
const BOOKING_STATUS_LABEL: Record<string, string> = {
  REQUESTED: 'Asked from dashboard',
  NEW: 'New request',
  DIRECT_CALL_BOOKED: 'Booked from website',
  CONFIRMED: 'Confirmed',
  RESCHEDULED: 'Moved to a new slot',
  COMPLETED: 'Completed',
  NO_SHOW: 'No show',
  CANCELLED: 'Cancelled'
};

const LEAD_STATUSES = ['NEW', 'DISCOVERY_STARTED', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'CLOSED'];
const LEAD_STATUS_LABEL: Record<string, string> = {
  NEW: 'New',
  DISCOVERY_STARTED: 'Started Discovery',
  CONTACTED: 'Contacted',
  QUALIFIED: 'Qualified',
  CONVERTED: 'Converted',
  CLOSED: 'Closed'
};

export const AdminWorkspacePage: React.FC = () => {
  const { user, authFetch } = useAuth();
  const navigate = useNavigate();
  const params = useParams<{ section?: string }>();

  // The sidebar owns navigation, so the current section comes from the URL.
  // That also makes every section linkable and survives a refresh.
  const activeTab: AdminSectionKey = params.section
    ? adminKeyFromPath(`/admin/${params.section}`)
    : 'overview';

  // A typed or stale URL like /admin/payroll should not sit on the overview
  // while the address bar says something else.
  const unknownSection =
    Boolean(params.section) && !ADMIN_SECTIONS.some((section) => section.key === params.section);
  useEffect(() => {
    if (unknownSection) navigate('/admin', { replace: true });
  }, [unknownSection, navigate]);

  const section = findAdminSection(activeTab);

  const setActiveTab = (key: AdminSectionKey) => {
    const target = ADMIN_SECTIONS.find((section) => section.key === key);
    navigate(target ? target.path : '/admin');
  };
  const [data, setData] = useState<any>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [rbacError, setRbacError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string>('');

  // ---- Paged lists. Every long list keeps its own query and page. ----
  const [taskQuery, setTaskQuery] = useState('');
  const [taskStatus, setTaskStatus] = useState('ALL');
  const [taskCourse, setTaskCourse] = useState('ALL');
  const [taskRange, setTaskRange] = useState('ALL');
  const [taskPage, setTaskPage] = useState(1);
  const [taskDetail, setTaskDetail] = useState<any>(null);

  const [leadQuery, setLeadQuery] = useState('');
  const [leadStatus, setLeadStatus] = useState('ALL');
  const [leadPage, setLeadPage] = useState(1);

  const [bookingQuery, setBookingQuery] = useState('');
  const [bookingStatus, setBookingStatus] = useState('ALL');
  const [bookingPage, setBookingPage] = useState(1);

  const [staffQueryText, setStaffQueryText] = useState('');
  const [staffRole, setStaffRole] = useState('ALL');
  const [staffPage, setStaffPage] = useState(1);

  const [auditQuery, setAuditQuery] = useState('');
  const [auditPage, setAuditPage] = useState(1);

  const [sessionPage, setSessionPage] = useState(1);
  const [scQuery, setScQuery] = useState('');
  const [scPage, setScPage] = useState(1);


  // Confirmation dialog state for destructive / state-changing actions
  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: React.ReactNode;
    confirmLabel: string;
    variant: 'danger' | 'primary';
    run: () => Promise<void> | void;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // Settings: change your own password
  const [ownCurrentPassword, setOwnCurrentPassword] = useState('');
  const [ownNewPassword, setOwnNewPassword] = useState('');
  const [ownConfirmPassword, setOwnConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Tab 1: Discovery Question & Answer Configurator State
  const [customCountN, setCustomCountN] = useState<number>(7);
  const [newQPrompt, setNewQPrompt] = useState<string>('');
  const [newQDomain, setNewQDomain] = useState<string>('DECISION_PROCESS');
  const [newQInputType, setNewQInputType] = useState<'single_choice' | 'text'>('single_choice');
  const [newQOptionsText, setNewQOptionsText] = useState<string>(
    'Yes. I follow a written checklist before entering\nSometimes. I have a general plan but adjust in the moment\nNo. I usually act reactively during live market hours'
  );
  const [showAllBankQuestions, setShowAllBankQuestions] = useState<boolean>(false);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [editQPrompt, setEditQPrompt] = useState<string>('');
  const [editQOptionsText, setEditQOptionsText] = useState<string>('');

  // Tab 2: Solved Discovery Q&A Viewer State
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');

  // Tab 3: Create Course, Assign Course & Give Task to Student State
  const [courseTitle, setCourseTitle] = useState<string>('');
  const [courseTrack, setCourseTrack] = useState<string>('student_concepts');
  const [courseLevel, setCourseLevel] = useState<string>('L1 → L2');
  const [courseDesc, setCourseDesc] = useState<string>('');
  const [courseModulesText, setCourseModulesText] = useState<string>(
    'Module 1: Core Market Concepts & Price Structure\nModule 2: Candlesticks & Heikin-Ashi Trend Rules\nModule 3: Strategy Qualification & Invalidation Stops\nModule 4: Practical Chart Exercises & Review'
  );

  // Course library: edit / delete courses and manage their questions
  const [editingCourseId, setEditingCourseId] = useState<string>('');
  const [editCourseTitle, setEditCourseTitle] = useState<string>('');
  const [editCourseTrack, setEditCourseTrack] = useState<string>('student_concepts');
  const [editCourseLevel, setEditCourseLevel] = useState<string>('L1 → L2');
  const [editCourseDesc, setEditCourseDesc] = useState<string>('');
  const [editCourseModulesText, setEditCourseModulesText] = useState<string>('');

  const [cqCourseId, setCqCourseId] = useState<string>('crs_heikin_ashi_01');
  const [cqPrompt, setCqPrompt] = useState<string>('');
  const [cqOptionsText, setCqOptionsText] = useState<string>(
    'Option A\nOption B\nOption C\nOption D'
  );
  const [cqCorrectIndex, setCqCorrectIndex] = useState<number>(0);
  const [cqExplanation, setCqExplanation] = useState<string>('');
  const [editingCqId, setEditingCqId] = useState<string>('');

  const [assignCourseId, setAssignCourseId] = useState<string>('crs_heikin_ashi_01');
  const [assignLearnerId, setAssignLearnerId] = useState<string>('usr_learner_aarav');
  const [assignNotes, setAssignNotes] = useState<string>(
    'Customised around your Discovery answers: Focus on Heikin-Ashi trend identification and disciplined risk rules.'
  );

  const [taskLearnerId, setTaskLearnerId] = useState<string>('usr_learner_aarav');
  const [taskCourseId, setTaskCourseId] = useState<string>('crs_heikin_ashi_01');
  const [taskTitle, setTaskTitle] = useState<string>('');
  const [taskCategory, setTaskCategory] = useState<string>('CHART_CONCEPT_LAB');
  const [taskInstructions, setTaskInstructions] = useState<string>('');
  const [taskExpectedCriteria, setTaskExpectedCriteria] = useState<string>('');
  const [taskFormOpen, setTaskFormOpen] = useState<boolean>(false);

  // Tab 4: Student Uploaded Results, AI Review & Direct Chat State
  const [selectedTaskId, setSelectedTaskId] = useState<string>('tsk_heikin_ashi_01');
  const [taskFilter, setTaskFilter] = useState<'ALL' | 'SUBMITTED'>('ALL');
  const [adminReviewFeedback, setAdminReviewFeedback] = useState<string>('');
  const [chatMessageText, setChatMessageText] = useState<string>('');
  const [reanalyzingAi, setReanalyzingAi] = useState<boolean>(false);

  // Tab 5: Account Provisioning & Rubric Governance State
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<'LEARNER' | 'GUIDE' | 'ADMIN' | 'CURRICULUM_OWNER'>('LEARNER');
  const [newTrack, setNewTrack] = useState<string>('student_concepts');

  const [compCode, setCompCode] = useState('COMP-PROC-01');
  const [compTitle, setCompTitle] = useState('Pre-Decision Process & Thesis Articulation');
  const [compDesc, setCompDesc] = useState('Defining written qualification and invalidation criteria prior to capital commitment.');
  const [rubricVer, setRubricVer] = useState('1.3.0');

  /**
   * Only counts and the small reference tables are loaded up front. Every long
   * list (learners, tasks, leads, bookings, staff, audit) has its own paged
   * endpoint, so the console stays quick with a thousand learners on it.
   */
  const loadAdminOverview = async () => {
    setRbacError(null);
    const res = await authFetch('/api/admin/metrics');
    if (res.status === 403 || res.status === 401) {
      const err = await res.json();
      setRbacError(err.error || 'Administrator authorisation required.');
      return;
    }
    if (res.ok) {
      const json = await res.json();
      setData(json);
      setDataVersion((v) => v + 1);
      if (typeof json.activeQuestionsCount === 'number') {
        setCustomCountN(json.activeQuestionsCount);
      }
    }
  };

  useEffect(() => {
    loadAdminOverview();
  }, [user]);

  // Pre-fill Admin review feedback when switching selected task
  useEffect(() => {
    if (!taskDetail) return;
    const curr = taskDetail;
    if (curr) {
      setAdminReviewFeedback(
        curr.guide_feedback ||
          curr.aiReview?.suggestedAdminFeedback ||
          'Reviewed your uploaded result. Good work on the core concepts!'
      );
    }
  }, [selectedTaskId, taskDetail]);

  const handleSetQuestionCountN = async (targetCount: number) => {
    const res = await authFetch('/api/admin/discovery-questions/set-count', {
      method: 'POST',
      body: JSON.stringify({ count: targetCount })
    });
    const out = await res.json();
    if (res.ok && out.success) {
      setCustomCountN(out.activeCount);
      setBanner(
        `✓ Discovery Questionnaire updated: Candidates will now answer N = ${out.activeCount} active Discovery questions.`
      );
      loadAdminOverview();
    }
  };

  const handleToggleQuestionActive = async (q: any) => {
    const res = await authFetch(`/api/admin/discovery-questions/${q.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !q.isActive })
    });
    const out = await res.json();
    if (res.ok && out.success) {
      setBanner(
        `✓ Question ${q.id} is now ${!q.isActive ? 'ACTIVE' : 'INACTIVE'} (Total active N = ${out.activeCount}).`
      );
      loadAdminOverview();
    }
  };

  const handleStartEditQuestion = (q: any) => {
    setEditingQuestionId(q.id);
    setEditQPrompt(q.prompt);
    const opts = Array.isArray(q.options) ? q.options.map((o: any) => o.label).join('\n') : '';
    setEditQOptionsText(opts);
  };

  const handleSaveEditedQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingQuestionId) return;
    const optionsList = editQOptionsText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    const res = await authFetch(`/api/admin/discovery-questions/${editingQuestionId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        prompt: editQPrompt.trim(),
        options: optionsList
      })
    });
    if (res.ok) {
      setBanner(`✓ Updated Discovery question ${editingQuestionId} and its answer options.`);
      setEditingQuestionId(null);
      loadAdminOverview();
    }
  };

  const handleAddCustomQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newQPrompt.trim()) return;
    const domainTitles: Record<string, string> = {
      PARTICIPATION_PROFILE: 'Market Participation & Baseline Context',
      DECISION_PROCESS: 'Preparation, Thesis & Risk Sizing',
      EXECUTION_BEHAVIOUR: 'Execution Under Uncertainty & Pressure',
      REVIEW_REFLECTION: 'Post-Decision Review & Emotional Regulation',
      DEVELOPMENT_GOALS: 'Learning Readiness & Open Synthesis'
    };
    const optionsList = newQOptionsText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    const res = await authFetch('/api/admin/discovery-questions', {
      method: 'POST',
      body: JSON.stringify({
        prompt: newQPrompt.trim(),
        domain: newQDomain,
        domainTitle: domainTitles[newQDomain] || 'Preparation, Thesis & Risk Sizing',
        inputType: newQInputType,
        options: optionsList,
        isActive: true
      })
    });
    const out = await res.json();
    if (res.ok && out.success) {
      setNewQPrompt('');
      setBanner(
        `✓ Added custom Discovery question & answers (${out.questionId}) to active set (Active N = ${out.activeCount}).`
      );
      loadAdminOverview();
    }
  };

  const handleCreateCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!courseTitle.trim() || !courseDesc.trim()) return;
    const modules = courseModulesText
      .split('\n')
      .map((m) => m.trim())
      .filter(Boolean);
    const res = await authFetch('/api/admin/courses', {
      method: 'POST',
      body: JSON.stringify({
        title: courseTitle.trim(),
        track: courseTrack,
        level: courseLevel,
        description: courseDesc.trim(),
        modules
      })
    });
    const out = await res.json();
    if (res.ok && out.success) {
      setCourseTitle('');
      setCourseDesc('');
      setAssignCourseId(out.courseId);
      setBanner(`✓ Created custom course "${courseTitle}" (${out.courseId}). You can now assign it to students!`);
      loadAdminOverview();
    }
  };

  const handleAssignCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await authFetch('/api/admin/courses/assign', {
      method: 'POST',
      body: JSON.stringify({
        courseId: assignCourseId,
        learnerId: assignLearnerId,
        customNotes: assignNotes.trim()
      })
    });
    const out = await res.json();
    if (res.ok && out.success) {
      setBanner(`✓ Assigned course to student (${out.assignmentId}) with custom learning notes.`);
      loadAdminOverview();
    }
  };

  const startEditingCourse = (course: any) => {
    setEditingCourseId(course.id);
    setEditCourseTitle(course.title);
    setEditCourseTrack(course.track);
    setEditCourseLevel(course.level);
    setEditCourseDesc(course.description);
    setEditCourseModulesText((course.modules || []).join('\n'));
  };

  const handleUpdateCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCourseId) return;
    const modules = editCourseModulesText.split('\n').map((m) => m.trim()).filter(Boolean);
    const res = await authFetch(`/api/admin/courses/${editingCourseId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        title: editCourseTitle.trim(),
        track: editCourseTrack,
        level: editCourseLevel,
        description: editCourseDesc.trim(),
        modules
      })
    });
    const out = await res.json();
    if (res.ok && out.success) {
      setBanner(`✓ Updated course "${editCourseTitle}" (${editingCourseId}) and its modules.`);
      setEditingCourseId('');
      loadAdminOverview();
    } else {
      setBanner(`⚠ ${out.error || 'Could not update the course.'}`);
    }
  };

  const handleDeleteCourse = (courseId: string, title: string) => {
    setConfirmState({
      title: 'Delete this course?',
      message: (
        <>
          <strong>{title}</strong> will be permanently deleted, together with its student assignments and course
          questions. This cannot be undone.
        </>
      ),
      confirmLabel: 'Delete course',
      variant: 'danger',
      run: async () => {
        const res = await authFetch(`/api/admin/courses/${courseId}`, { method: 'DELETE' });
        const out = await res.json();
        if (res.ok && out.success) {
          setBanner(
            `✓ Deleted course "${title}" (${out.removedAssignments} assignment(s), ${out.removedQuestions} question(s) removed).`
          );
          if (editingCourseId === courseId) setEditingCourseId('');
          loadAdminOverview();
        } else {
          setBanner(`⚠ ${out.error || 'Could not delete the course.'}`);
        }
      }
    });
  };

  const handleSaveCourseQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cqPrompt.trim()) return;
    const options = cqOptionsText.split('\n').map((o) => o.trim()).filter(Boolean);
    if (options.length < 2) {
      setBanner('⚠ Please provide at least two answer options (one per line).');
      return;
    }
    const payload = {
      prompt: cqPrompt.trim(),
      options,
      correctOptionIndex: Math.min(cqCorrectIndex, options.length - 1),
      explanation: cqExplanation.trim()
    };
    const res = editingCqId
      ? await authFetch(`/api/admin/course-questions/${editingCqId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        })
      : await authFetch(`/api/admin/courses/${cqCourseId}/questions`, {
          method: 'POST',
          body: JSON.stringify(payload)
        });
    const out = await res.json();
    if (res.ok && out.success) {
      setBanner(editingCqId ? '✓ Updated course question.' : `✓ Added question to course (${cqCourseId}). Students will see it in their course.`);
      setCqPrompt('');
      setCqExplanation('');
      setCqOptionsText('Option A\nOption B\nOption C\nOption D');
      setCqCorrectIndex(0);
      setEditingCqId('');
      loadAdminOverview();
    } else {
      setBanner(`⚠ ${out.error || 'Could not save the question.'}`);
    }
  };

  const startEditingCourseQuestion = (q: any) => {
    setEditingCqId(q.id);
    setCqCourseId(q.course_id);
    setCqPrompt(q.prompt);
    setCqOptionsText((q.options || []).join('\n'));
    setCqCorrectIndex(Number(q.correct_option_index) || 0);
    setCqExplanation(q.explanation || '');
  };

  const handleDeleteCourseQuestion = (questionId: string) => {
    const question = courseQuestionsList.find((q: any) => q.id === questionId);
    setConfirmState({
      title: 'Delete this question?',
      message: (
        <>
          {question ? <>“{question.prompt}” </> : 'This question '}
          will be removed from the course, along with every student attempt recorded for it.
        </>
      ),
      confirmLabel: 'Delete question',
      variant: 'danger',
      run: async () => {
        const res = await authFetch(`/api/admin/course-questions/${questionId}`, { method: 'DELETE' });
        const out = await res.json();
        if (res.ok && out.success) {
          setBanner('✓ Deleted course question.');
          if (editingCqId === questionId) setEditingCqId('');
          loadAdminOverview();
        } else {
          setBanner(`⚠ ${out.error || 'Could not delete the question.'}`);
        }
      }
    });
  };

  const handleFillHeikinAshiTaskPreset = () => {
    setTaskTitle('Find Heikin-Ashi Trend Continuation & Reversal Signals on Chart');
    setTaskCategory('CHART_CONCEPT_LAB');
    setTaskInstructions(
      '1. Find a clean Heikin-Ashi trend on a 15m or Daily chart and upload your annotated chart/result.\n' +
        '2. Explain the Heikin-Ashi Close formula ((O+H+L+C)/4) and Open formula (midpoint of prior HA body).\n' +
        '3. Mark consecutive green Heikin-Ashi candles with NO lower wicks (strong uptrend) and a Heikin-Ashi Doji exhaustion candle.'
    );
    setTaskExpectedCriteria(
      'Must identify Heikin-Ashi formula (O+H+L+C)/4, midpoint HA Open, strong uptrend candles lacking lower wicks/shadows, Doji reversal with upper & lower shadows, and note that HA prices are synthetic averaged prices vs real market LTP.'
    );
  };

  const handleAssignTaskToStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim() || !taskInstructions.trim()) return;
    const res = await authFetch('/api/admin/tasks', {
      method: 'POST',
      body: JSON.stringify({
        learnerId: taskLearnerId,
        courseId: taskCourseId,
        title: taskTitle.trim(),
        category: taskCategory,
        instructions: taskInstructions.trim(),
        expectedCriteria: taskExpectedCriteria.trim() || taskInstructions.trim(),
        competencyCode: 'COMP-PROC-01'
      })
    });
    const out = await res.json();
    if (res.ok && out.success) {
      setTaskTitle('');
      setTaskInstructions('');
      setTaskExpectedCriteria('');
      setSelectedTaskId(out.taskId);
      setBanner(
        `✓ Assigned task "${taskTitle}" (${out.taskId}) to student. When the student uploads their result, AI will automatically pre-review it for you!`
      );
      loadAdminOverview();
    }
  };

  const handleReanalyzeTaskWithAI = async (taskId: string) => {
    setReanalyzingAi(true);
    try {
      const res = await authFetch(`/api/admin/tasks/${taskId}/ai-reanalyze`, {
        method: 'POST'
      });
      const out = await res.json();
      if (res.ok && out.success) {
        setBanner(`✓ AI Task Pre-Review refreshed for task ${taskId}: Verdict = ${out.aiReview.verdict} (${out.aiReview.accuracyScore}%).`);
        loadAdminOverview();
      }
    } finally {
      setReanalyzingAi(false);
    }
  };

  const handleSubmitAdminTaskReview = async (taskId: string, status: 'REVIEWED' | 'CHANGES_REQUESTED') => {
    if (!adminReviewFeedback.trim()) return;
    const res = await authFetch(`/api/admin/tasks/${taskId}/review`, {
      method: 'POST',
      body: JSON.stringify({
        status,
        guideFeedback: adminReviewFeedback.trim()
      })
    });
    const out = await res.json();
    if (res.ok && out.success) {
      setBanner(
        `✓ Task ${taskId} marked as ${status === 'REVIEWED' ? 'APPROVED & REVIEWED' : 'REVISION REQUESTED'} and sent to student!`
      );
      loadAdminOverview();
    }
  };

  const handleSendTaskChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessageText.trim() || !selectedTaskId) return;
    const res = await authFetch(`/api/tasks/${selectedTaskId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ message: chatMessageText.trim() })
    });
    if (res.ok) {
      setChatMessageText('');
      const fresh = await authFetch(`/api/admin/tasks/${selectedTaskId}`);
      if (fresh.ok) {
        const json = await fresh.json();
        setTaskDetail(json.task);
      }
      loadAdminOverview();
    }
  };

  const handleProvisionUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await authFetch('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        name: newName,
        email: newEmail,
        role: newRole,
        track: newTrack
      })
    });
    const out = await res.json();
    if (res.ok && out.success) {
      setBanner(
        out.temporaryPassword
          ? `✓ Provisioned ${newName} (${newRole}). Temporary password, shown once: ${out.temporaryPassword}`
          : `✓ Provisioned new ${newRole} account (${newName}) and logged to Audit Trail.`
      );
      setNewName('');
      setNewEmail('');
      loadAdminOverview();
    } else {
      setBanner(`⚠ ${out.error || 'Failed to provision user'}`);
    }
  };

  const handleToggleUserStatus = (u: any) => {
    const suspending = u.account_status === 'ACTIVE';
    const nextStatus = suspending ? 'SUSPENDED' : 'ACTIVE';
    setConfirmState({
      title: suspending ? 'Deactivate this account?' : 'Activate this account?',
      message: suspending ? (
        <>
          <strong>{u.name}</strong> ({u.email}) will no longer be able to sign in until the account is reactivated.
          Existing data is kept and the change is written to the audit trail.
        </>
      ) : (
        <>
          <strong>{u.name}</strong> ({u.email}) will regain access to FRINS with their existing role.
        </>
      ),
      confirmLabel: suspending ? 'Deactivate account' : 'Activate account',
      variant: suspending ? 'danger' : 'primary',
      run: async () => {
        const res = await authFetch(`/api/admin/users/${u.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ accountStatus: nextStatus })
        });
        if (res.ok) {
          setBanner(`✓ Updated ${u.name} status to ${nextStatus} (Audited).`);
          loadAdminOverview();
        } else {
          setBanner(`⚠ Could not update ${u.name}.`);
        }
      }
    });
  };

  const handleUpdateRubric = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await authFetch('/api/admin/competencies', {
      method: 'POST',
      body: JSON.stringify({
        code: compCode,
        title: compTitle,
        description: compDesc,
        rubricVersion: rubricVer
      })
    });
    const out = await res.json();
    if (res.ok && out.success) {
      setBanner(`✓ Core Competency ${compCode} updated to Rubric v${rubricVer} and recorded in Audit Trail.`);
      loadAdminOverview();
    }
  };

  const handleBookingStatus = async (bookingId: string, status: string) => {
    const res = await authFetch(`/api/admin/bookings/${bookingId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
    if (res.ok) {
      setBanner(`Booking moved to ${BOOKING_STATUS_LABEL[status] || status}.`);
      loadAdminOverview();
    } else {
      setBanner('Could not update that booking.');
    }
  };

  const handleLeadStatus = async (leadId: string, status: string) => {
    const res = await authFetch(`/api/admin/leads/${leadId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
    if (res.ok) {
      setBanner(`Lead moved to ${LEAD_STATUS_LABEL[status] || status}.`);
      loadAdminOverview();
    } else {
      setBanner('Could not update that lead.');
    }
  };

  const handleResetPassword = (u: any) => {
    setConfirmState({
      title: `Reset the password for ${u.name}?`,
      message: (
        <>
          <p>They will be signed out everywhere and will need the new password to get back in.</p>
          <p style={{ marginTop: 8 }}>
            The new password is shown to you once. Pass it on to them, and ask them to change it after
            signing in.
          </p>
        </>
      ),
      confirmLabel: 'Reset password',
      variant: 'primary',
      run: async () => {
        const res = await authFetch(`/api/admin/users/${u.id}/reset-password`, { method: 'POST' });
        const out = await res.json();
        if (res.ok && out.success) {
          setBanner(`New password for ${u.name}: ${out.temporaryPassword} (shown once, copy it now)`);
          loadAdminOverview();
        } else {
          setBanner(`Could not reset the password: ${out.error || 'unknown error'}`);
        }
      }
    });
  };

  const handleRoleChange = (u: any, nextRole: string) => {
    setConfirmState({
      title: `Change ${u.name} to ${nextRole}?`,
      message: `Their access changes straight away. Every change is written to the audit trail.`,
      confirmLabel: 'Change role',
      variant: 'primary',
      run: async () => {
        const res = await authFetch(`/api/admin/users/${u.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ role: nextRole })
        });
        if (res.ok) {
          setBanner(`${u.name} is now ${nextRole}.`);
          loadAdminOverview();
        } else {
          setBanner(`Could not change the role for ${u.name}.`);
        }
      }
    });
  };

  const handleChangeOwnPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    if (ownNewPassword.length < 8) {
      setPasswordError('Use at least 8 characters for the new password.');
      return;
    }
    if (ownNewPassword !== ownConfirmPassword) {
      setPasswordError('The two new passwords do not match.');
      return;
    }
    setPasswordBusy(true);
    try {
      const res = await authFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: ownCurrentPassword, newPassword: ownNewPassword })
      });
      const out = await res.json();
      if (res.ok && out.success) {
        setBanner('Your password is updated. Other devices were signed out.');
        setOwnCurrentPassword('');
        setOwnNewPassword('');
        setOwnConfirmPassword('');
      } else {
        setPasswordError(out.error || 'Could not update your password.');
      }
    } finally {
      setPasswordBusy(false);
    }
  };

  // ---- Paged data. Hooks run before any early return. ----
  const tasksQuery = usePagedList(authFetch, '/api/admin/tasks', {
    q: taskQuery,
    v: dataVersion,
    status: taskStatus,
    courseId: taskCourse,
    range: taskRange,
    page: taskPage,
    limit: 20
  });
  const leadsQuery = usePagedList(authFetch, '/api/admin/leads', {
    q: leadQuery,
    v: dataVersion,
    status: leadStatus,
    page: leadPage,
    limit: 20
  });
  const bookingsQuery = usePagedList(authFetch, '/api/admin/bookings', {
    q: bookingQuery,
    v: dataVersion,
    status: bookingStatus,
    page: bookingPage,
    limit: 20
  });
  const staffQuery = usePagedList(authFetch, '/api/admin/users', {
    q: staffQueryText,
    v: dataVersion,
    role: staffRole,
    page: staffPage,
    limit: 20
  });
  const auditQueryList = usePagedList(authFetch, '/api/admin/audit', {
    q: auditQuery,
    v: dataVersion,
    page: auditPage,
    limit: 25
  });
  const sessionsQuery = usePagedList(authFetch, '/api/admin/discovery-sessions', {
    page: sessionPage,
    v: dataVersion,
    limit: 12
  });
  const studentCoursesQuery = usePagedList(authFetch, '/api/admin/student-courses', {
    q: scQuery,
    v: dataVersion,
    page: scPage,
    limit: 20
  });
  const directoryQuery = usePagedList(authFetch, '/api/admin/learners/directory', { v: dataVersion });
  const recentAuditQuery = usePagedList(authFetch, '/api/admin/audit', { limit: 5, v: dataVersion });
  const recentLeadsQuery = usePagedList(authFetch, '/api/admin/leads', { limit: 5, v: dataVersion });

  // The list is light on purpose. Open one task to get the submission, the AI
  // pre-check and the chat.
  useEffect(() => {
    if (!selectedTaskId) return;
    let cancelled = false;
    (async () => {
      const res = await authFetch(`/api/admin/tasks/${selectedTaskId}`);
      if (res.ok) {
        const json = await res.json();
        if (!cancelled) setTaskDetail(json.task);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedTaskId, authFetch]);

  useEffect(() => {
    if (tasksQuery.rows.length === 0) return;
    if (!tasksQuery.rows.some((t: any) => t.id === selectedTaskId)) {
      setSelectedTaskId(tasksQuery.rows[0].id);
    }
  }, [tasksQuery.rows, selectedTaskId]);

  const hasAdminAccess = user?.role === 'ADMIN' || user?.role === 'CURRICULUM_OWNER';

  if (!hasAdminAccess) {
    return (
      <StaffSignInGate
        consoleName="Admin Console"
        allowedRoles={['ADMIN', 'CURRICULUM_OWNER']}
        currentRole={user?.role}
      />
    );
  }

  if (rbacError) {
    return (
      <StaffSignInGate
        consoleName="Admin Console"
        allowedRoles={['ADMIN', 'CURRICULUM_OWNER']}
        currentRole={user?.role}
      />
    );
  }

  const allQuestions: any[] = data?.discoveryQuestions || [];
  const activeQuestions = allQuestions.filter((q) => q.isActive);
  const displayedQuestions = showAllBankQuestions ? allQuestions : activeQuestions;

  const solvedSessions: any[] = sessionsQuery.rows;
  const selectedSession =
    solvedSessions.find((s) => s.id === selectedSessionId) || solvedSessions[0] || null;

  const learnersList: any[] = directoryQuery.rows;
  const coursesList: any[] = data?.courses || [];
  const studentCoursesList: any[] = studentCoursesQuery.rows;
  const courseQuestionsList: any[] = data?.courseQuestions || [];
  const leadsList: any[] = leadsQuery.rows;
  const cqOptionList = cqOptionsText.split('\n').map((o) => o.trim()).filter(Boolean);
  const allStudentTasks: any[] = tasksQuery.rows;
  const filteredTasks = allStudentTasks;
  const selectedTask =
    (taskDetail && taskDetail.id === selectedTaskId ? taskDetail : null) ||
    allStudentTasks.find((t) => t.id === selectedTaskId) ||
    null;

  // Counts come from the metrics endpoint, not from the rows on screen.
  const metrics = data?.metrics || {};
  const bookingsList: any[] = bookingsQuery.rows;
  const staffList: any[] = staffQuery.rows;
  const auditList: any[] = auditQueryList.rows;
  const latestAudit: any[] = recentAuditQuery.rows;
  const latestLeads: any[] = recentLeadsQuery.rows;

  return (
    <div className="workspace-shell">
      <div className="container-wide">
        <div className="admin-body">
          {activeTab !== 'overview' && activeTab !== 'learners' && activeTab !== 'tasks' && (
            <header className="admin-page-head">
              <span className="admin-page-eyebrow">Admin console</span>
              <h1>{section.label}</h1>
              <p>{section.hint}.</p>
            </header>
          )}

          {activeTab === 'overview' && (
          <>
        <div className="dash-hero">
          <div className="dash-hero-tags">
            <span className="micro-tag accent">Admin Workspace</span>
            <span className="micro-tag success">{user?.name} · {user?.role}</span>
            <span className="micro-tag">Discovery N = {activeQuestions.length}</span>
            {(data?.metrics?.submittedTasksForReview ?? 0) > 0 && (
              <span className="micro-tag warn">
                {data.metrics.submittedTasksForReview} submission(s) awaiting review
              </span>
            )}
          </div>
          <h1>Operations Overview</h1>
          <p>
            Everything you need in one place: Discovery questions, website leads, call bookings, courses, student
            tasks and submission reviews.
          </p>
        </div>

        <div className="dash-stats">
          <div className="dash-stat">
            <span className="dash-stat-icon"><Users size={17} /></span>
            <div className="dash-stat-body">
              <span className="dash-stat-label">Website Leads</span>
              <span className="dash-stat-value">{data?.metrics?.totalLeads ?? 0}</span>
              <span className="dash-stat-hint">From the website form</span>
            </div>
          </div>
          <div className="dash-stat">
            <span className="dash-stat-icon green"><CalendarCheck size={17} /></span>
            <div className="dash-stat-body">
              <span className="dash-stat-label">Call Bookings</span>
              <span className="dash-stat-value">{data?.metrics?.totalCallBookings ?? 0}</span>
              <span className="dash-stat-hint">Direct & post-Discovery</span>
            </div>
          </div>
          <div className="dash-stat">
            <span className="dash-stat-icon amber"><ClipboardList size={17} /></span>
            <div className="dash-stat-body">
              <span className="dash-stat-label">Awaiting Review</span>
              <span className="dash-stat-value">{data?.metrics?.submittedTasksForReview ?? 0}</span>
              <span className="dash-stat-hint">Student task uploads</span>
            </div>
          </div>
          <div className="dash-stat">
            <span className="dash-stat-icon slate"><BookOpen size={17} /></span>
            <div className="dash-stat-body">
              <span className="dash-stat-label">Courses</span>
              <span className="dash-stat-value">{coursesList.length}</span>
              <span className="dash-stat-hint">{courseQuestionsList.length} questions · {studentCoursesList.length} assigned</span>
            </div>
          </div>
          <div className="dash-stat">
            <span className="dash-stat-icon"><GraduationCap size={17} /></span>
            <div className="dash-stat-body">
              <span className="dash-stat-label">Active Learners</span>
              <span className="dash-stat-value">{data?.metrics?.activeLearners ?? 0}</span>
              <span className="dash-stat-hint">of {data?.metrics?.totalUsers ?? 0} accounts</span>
            </div>
          </div>
          <div className="dash-stat">
            <span className="dash-stat-icon rose"><HelpCircle size={17} /></span>
            <div className="dash-stat-body">
              <span className="dash-stat-label">Discovery Solved</span>
              <span className="dash-stat-value">
                {data?.metrics?.completedDiscoveries ?? 0}
              </span>
              <span className="dash-stat-hint">Candidates with answers</span>
            </div>
          </div>
        </div>
          </>
        )}

        {banner && (
          <div className={`admin-banner ${banner.startsWith('✓') ? 'ok' : 'info'}`} role="status">
            {banner}
            <button type="button" className="admin-banner-close" onClick={() => setBanner('')} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}

        {activeTab === 'overview' && (
          <>
          <div className="admin-quick-grid">
            {[
              {
                key: 'tasks' as AdminSectionKey,
                title: 'Review uploads',
                body: (() => {
                  const n = allStudentTasks.filter((t) => t.status === 'SUBMITTED').length;
                  return n === 1 ? '1 submission is waiting for a review.' : `${n} submissions are waiting for a review.`;
                })(),
                cta: 'Open task review'
              },
              {
                key: 'leads' as AdminSectionKey,
                title: 'New leads',
                body: (() => {
                  const n = data?.metrics?.newLeads ?? 0;
                  if (n === 0) return 'Everyone who came in from the website has been contacted.';
                  return n === 1
                    ? '1 person came in from the website and has not been contacted yet.'
                    : `${n} people came in from the website and have not been contacted yet.`;
                })(),
                cta: 'Open leads'
              },
              {
                key: 'bookings' as AdminSectionKey,
                title: 'Upcoming calls',
                body: (() => {
                  const n = data?.metrics?.totalCallBookings ?? 0;
                  if (n === 0) return 'No calls are booked right now.';
                  return n === 1 ? '1 call is on the calendar.' : `${n} calls are on the calendar.`;
                })(),
                cta: 'Open bookings'
              },
              {
                key: 'learners' as AdminSectionKey,
                title: 'Learner reviews',
                body: (() => {
                  const n = data?.metrics?.pendingPDPReviews ?? 0;
                  if (n === 0) return 'No learning plans are waiting for a decision.';
                  return n === 1
                    ? '1 learning plan is waiting for a decision.'
                    : `${n} learning plans are waiting for a decision.`;
                })(),
                cta: 'Open learners'
              }
            ].map((card) => (
              <button
                key={card.key}
                type="button"
                className="admin-quick-card"
                onClick={() => setActiveTab(card.key)}
              >
                <strong>{card.title}</strong>
                <p>{card.body}</p>
                <span>{card.cta} &rarr;</span>
              </button>
            ))}
          </div>

          <div className="admin-overview-grid">
            <section className="panel-card">
              <span className="micro-tag accent">Latest activity</span>
              <h3 className="admin-card-title">What just happened</h3>
              <p className="admin-card-copy">The last few actions across the console.</p>
              <div className="admin-audit">
                {(() => {
                  const events: any[] = latestAudit;
                  // Logins are routine. Show the things that changed something first.
                  const meaningful = events.filter((ev) => ev.action !== 'USER_LOGIN_SUCCESS');
                  const shown = (meaningful.length >= 3 ? meaningful : events).slice(0, 5);
                  if (shown.length === 0) {
                    return <p className="admin-muted">No activity yet. It will show up here as the team works.</p>;
                  }
                  return shown.map((ev: any) => (
                    <div key={ev.id} className="admin-audit-row">
                      <div>
                        <strong>{ev.action.replaceAll('_', ' ').toLowerCase()}</strong>
                        <small>{ev.entity_type} &middot; {String(ev.entity_id).replaceAll('_', ' ')}</small>
                      </div>
                      <div className="admin-audit-meta">
                        <span className="micro-tag" style={{ fontSize: 10 }}>{ev.actor_role}</span>
                        <small>{new Date(ev.created_at).toLocaleDateString()}</small>
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </section>

            <section className="panel-card">
              <span className="micro-tag accent">Pipeline</span>
              <h3 className="admin-card-title">Newest leads</h3>
              <p className="admin-card-copy">People who filled the form on the website.</p>
              {latestLeads.length === 0 ? (
                <p className="admin-muted">No leads yet.</p>
              ) : (
                <div className="admin-mini-list">
                  {latestLeads.map((lead: any) => (
                    <div key={lead.id} className="admin-mini-row">
                      <div>
                        <strong>{lead.name}</strong>
                        <small>{lead.track === 'other' ? lead.custom_track || 'Other' : lead.track}</small>
                      </div>
                      <span className="micro-tag">{String(lead.status).replaceAll('_', ' ').toLowerCase()}</span>
                    </div>
                  ))}
                </div>
              )}
              <button type="button" className="admin-link-button" onClick={() => setActiveTab('leads')}>
                Open the leads inbox
              </button>
            </section>
          </div>
          </>
        )}
        {/* ===================================================================
            TAB 1: STUDENT UPLOADED RESULTS, INTERNAL AI PRE-REVIEW & DIRECT CHAT
           =================================================================== */}
        {activeTab === 'tasks' && (
          <>
          <div className="compact-head">
            <div>
              <span className="admin-page-eyebrow">Admin console</span>
              <h1>Tasks</h1>
            </div>
            <div className="head-stats">
              <span className="micro-tag">{(tasksQuery as any).total ?? allStudentTasks.length} in the queue</span>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setTaskFormOpen((v) => !v)}>
                {taskFormOpen ? 'Close form' : '+ Give a task'}
              </button>
            </div>
          </div>

          {taskFormOpen && (
          <section className="panel-card assign-task-card" style={{ border: '1px solid var(--accent-border)' }}>
            <div className="form-head">
              <div>
                <span className="micro-tag accent">Give a task</span>
                <h3 className="admin-card-title" style={{ marginTop: 6 }}>Assign a practical task</h3>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleFillHeikinAshiTaskPreset}
              >
                ⚡ Load sample task
              </button>
            </div>
            <p className="admin-card-copy">
              The learner uploads their work, the internal AI pre-checks it against your criteria, and it lands in
              the queue below for your review.
            </p>

            <form onSubmit={handleAssignTaskToStudent} className="admin-form">
              <div className="workspace-grid-2" style={{ gap: 10 }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="taskLearner">Assign to learner *</label>
                  <select
                    id="taskLearner"
                    className="form-select"
                    value={taskLearnerId}
                    onChange={(e) => setTaskLearnerId(e.target.value)}
                  >
                    {learnersList.map((l: any) => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({l.email})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="taskCourse">Linked course</label>
                  <select
                    id="taskCourse"
                    className="form-select"
                    value={taskCourseId}
                    onChange={(e) => setTaskCourseId(e.target.value)}
                  >
                    {coursesList.map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="taskTitle">Task title *</label>
                <input
                  id="taskTitle"
                  className="form-input"
                  placeholder="e.g. Find Heikin-Ashi trend continuation and one reversal"
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  required
                />
              </div>

              <div className="admin-form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="taskInstructions">Instructions for the learner *</label>
                  <textarea
                    id="taskInstructions"
                    className="form-textarea"
                    rows={3}
                    placeholder="What they need to find, analyse and upload."
                    value={taskInstructions}
                    onChange={(e) => setTaskInstructions(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="taskCriteria">Expected answer (AI pre-check)</label>
                  <textarea
                    id="taskCriteria"
                    className="form-textarea"
                    rows={3}
                    placeholder="What a correct submission has to mention. Kept on the team side."
                    value={taskExpectedCriteria}
                    onChange={(e) => setTaskExpectedCriteria(e.target.value)}
                  />
                </div>
              </div>

              <button type="submit" className="btn btn-primary">
                Assign task
              </button>
            </form>
          </section>
          )}

          <div className="workspace-sidebar-layout">
            {/* Left Sidebar: List of Student Tasks & Uploaded Submissions */}
            <div className="panel-card" style={{ marginBottom: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span className="micro-tag accent">Task queue ({tasksQuery.total.toLocaleString()})</span>
              </div>

              <div className="list-tools">
                <input
                  className="form-input list-search"
                  placeholder="Search task, learner or email"
                  value={taskQuery}
                  onChange={(e) => {
                    setTaskQuery(e.target.value);
                    setTaskPage(1);
                  }}
                  aria-label="Search tasks"
                />
                <select
                  className="form-select list-filter"
                  value={taskStatus}
                  onChange={(e) => {
                    setTaskStatus(e.target.value);
                    setTaskPage(1);
                  }}
                  aria-label="Filter by status"
                >
                  <option value="ALL">Every status</option>
                  <option value="SUBMITTED">Waiting for review</option>
                  <option value="ASSIGNED">Not started</option>
                  <option value="REVIEWED">Reviewed</option>
                </select>
                <select
                  className="form-select list-filter"
                  value={taskCourse}
                  onChange={(e) => {
                    setTaskCourse(e.target.value);
                    setTaskPage(1);
                  }}
                  aria-label="Filter tasks by course"
                >
                  <option value="ALL">Every course</option>
                  {coursesList.map((course: any) => (
                    <option key={course.id} value={course.id}>
                      {course.title}
                    </option>
                  ))}
                </select>
                <select
                  className="form-select list-filter"
                  value={taskRange}
                  onChange={(e) => {
                    setTaskRange(e.target.value);
                    setTaskPage(1);
                  }}
                  aria-label="Filter tasks by date"
                >
                  <option value="ALL">Any date</option>
                  <option value="TODAY">Today</option>
                  <option value="WEEK">Last 7 days</option>
                  <option value="MONTH">Last 30 days</option>
                  <option value="DUE">Due in the next 3 days</option>
                </select>
              </div>

              <h3 style={{ fontSize: 16, marginBottom: 10 }}>
                Pick a task to review{' '}
                {tasksQuery.loading && <span className="admin-muted">(loading...)</span>}
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {filteredTasks.map((t: any) => {
                  const isSel = selectedTask?.id === t.id;
                  const aiVerdict = t.aiReview?.verdict;
                  return (
                    <div
                      key={t.id}
                      onClick={() => setSelectedTaskId(t.id)}
                      style={{
                        padding: 14,
                        borderRadius: 10,
                        border: isSel ? '2px solid var(--accent)' : '1px solid var(--border-subtle)',
                        background: isSel ? 'var(--accent-soft)' : 'var(--bg-canvas)',
                        cursor: 'pointer'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <strong style={{ fontSize: 13.5, color: 'var(--text-main)' }}>{t.learner_name}</strong>
                        <span
                          className={`status-pill ${
                            t.status === 'REVIEWED'
                              ? 'approved'
                              : t.status === 'SUBMITTED'
                                ? 'info'
                                : 'pending'
                          }`}
                        >
                          {t.status}
                        </span>
                      </div>

                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{t.title}</div>

                      {t.course_title && (
                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 6 }}>
                          Course: {t.course_title}
                        </div>
                      )}

                      <div className="task-dates">
                        <span>Given {formatDateTime(t.assigned_at)}</span>
                        {t.submitted_at && <span>Uploaded {formatDateTime(t.submitted_at)}</span>}
                        {t.reviewed_at && <span>Reviewed {formatDateTime(t.reviewed_at)}</span>}
                      </div>

                      {aiVerdict && (
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: '4px 8px',
                            borderRadius: 4,
                            background:
                              aiVerdict === 'CORRECT'
                                ? '#D1FAE5'
                                : aiVerdict === 'PARTIALLY_CORRECT'
                                  ? '#FEF3C7'
                                  : '#FEE2E2',
                            color:
                              aiVerdict === 'CORRECT'
                                ? '#065F46'
                                : aiVerdict === 'PARTIALLY_CORRECT'
                                  ? '#92400E'
                                  : '#991B1B',
                            display: 'inline-block'
                          }}
                        >
                          AI pre-check: {String(aiVerdict).replaceAll('_', ' ').toLowerCase()}
                          {t.aiConfidence != null ? ` (${t.aiConfidence}%)` : ''}
                        </div>
                      )}
                    </div>
                  );
                })}
                {!tasksQuery.loading && allStudentTasks.length === 0 && (
                  <p className="admin-muted">No task matches this search and filter.</p>
                )}
              </div>

              <Pager
                page={tasksQuery.page}
                pages={tasksQuery.pages}
                total={tasksQuery.total}
                limit={20}
                onChange={setTaskPage}
                noun="tasks"
              />
            </div>

            {/* Right Main Panel: Uploaded Result + Internal AI Review (Admin/Team Only) + Direct Chat + Official Review */}
            {selectedTask ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* 1. Student Uploaded Result & Visual Chart Artifact */}
                <div className="panel-card" style={{ marginBottom: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
                    <div style={{ minWidth: 0 }}>
                      <span className="micro-tag accent task-category-tag">
                        Student task &middot; {selectedTask.category}
                      </span>
                      <h2 style={{ fontSize: 22, marginTop: 6 }}>{selectedTask.title}</h2>
                      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                        Student: <strong>{selectedTask.learner_name}</strong> ({selectedTask.learner_email}) &middot; Course:{' '}
                        <strong>{selectedTask.course_title || 'Custom plan'}</strong>
                      </div>
                      <div className="task-timeline task-timeline-wide">
                        <span>
                          <em>Given</em>
                          {formatDateTime(selectedTask.assigned_at)}
                        </span>
                        <span>
                          <em>Due</em>
                          {formatDateTime(selectedTask.due_date)}
                        </span>
                        <span>
                          <em>Uploaded</em>
                          {selectedTask.submitted_at ? formatDateTime(selectedTask.submitted_at) : 'Not yet'}
                        </span>
                        <span>
                          <em>Reviewed</em>
                          {selectedTask.reviewed_at ? formatDateTime(selectedTask.reviewed_at) : 'Not yet'}
                        </span>
                      </div>
                    </div>
                    <span
                      className={`status-pill ${
                        selectedTask.status === 'REVIEWED'
                          ? 'approved'
                          : selectedTask.status === 'SUBMITTED'
                            ? 'info'
                            : 'pending'
                      }`}
                    >
                      Status: {selectedTask.status}
                    </span>
                  </div>

                  <div
                    style={{
                      padding: 14,
                      background: 'var(--bg-canvas)',
                      borderRadius: 10,
                      border: '1px solid var(--border-subtle)',
                      fontSize: 13.5,
                      marginBottom: 16
                    }}
                  >
                    <strong>Task Instructions Given by Admin:</strong>
                    <div style={{ whiteSpace: 'pre-line', color: 'var(--text-muted)', marginTop: 4 }}>
                      {selectedTask.instructions}
                    </div>
                    {selectedTask.expected_criteria && (
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border-subtle)', fontSize: 12.5 }}>
                        <strong>Expected Criteria for AI Check:</strong> {selectedTask.expected_criteria}
                      </div>
                    )}
                  </div>

                  {/* Student Uploaded Answer & Chart Image Preview */}
                  <div
                    style={{
                      padding: 18,
                      background: '#FFFFFF',
                      borderRadius: 12,
                      border: '2px solid var(--accent-border)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <strong style={{ fontSize: 15, color: 'var(--accent)' }}>
                        📥 Student Uploaded Result &amp; Answer
                      </strong>
                      {selectedTask.submitted_at && (
                        <span style={{ fontSize: 12, color: 'var(--text-light-muted)' }}>
                          Uploaded: {new Date(selectedTask.submitted_at).toLocaleString()}
                        </span>
                      )}
                    </div>

                    {selectedTask.learner_submission ? (
                      <>
                        <div
                          style={{
                            whiteSpace: 'pre-line',
                            fontSize: 14,
                            lineHeight: 1.65,
                            color: 'var(--text-main)',
                            padding: 14,
                            background: 'var(--bg-canvas)',
                            borderRadius: 8,
                            border: '1px solid var(--border-subtle)',
                            marginBottom: selectedTask.uploaded_file_data ? 14 : 0
                          }}
                        >
                          {selectedTask.learner_submission}
                        </div>

                        {selectedTask.uploaded_file_name && (
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>
                            Attached Chart / Result File: <code>{selectedTask.uploaded_file_name}</code>
                          </div>
                        )}

                        {selectedTask.uploaded_file_data && (
                          <div
                            style={{
                              borderRadius: 10,
                              overflow: 'hidden',
                              border: '1px solid var(--border-subtle)',
                              background: '#0F172A',
                              padding: 8,
                              textAlign: 'center'
                            }}
                          >
                            <img
                              src={selectedTask.uploaded_file_data}
                              alt={selectedTask.uploaded_file_name || 'Student Uploaded Chart Result'}
                              style={{ maxWidth: '100%', height: 'auto', borderRadius: 8, display: 'block', margin: '0 auto' }}
                            />
                          </div>
                        )}
                      </>
                    ) : (
                      <div style={{ padding: 16, color: 'var(--text-light-muted)', fontSize: 13.5 }}>
                        Student has not uploaded their result for this task yet.
                      </div>
                    )}
                  </div>
                </div>

                {/* 2. INTERNAL AI PRE-REVIEW (Strictly visible only to Admin & Team, hidden from the student!) */}
                <div
                  className="panel-card"
                  style={{
                    marginBottom: 0,
                    background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)',
                    color: '#F8FAFC',
                    border: '2px solid #3B82F6'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span
                        style={{
                          padding: '4px 10px',
                          borderRadius: 4,
                          background: 'rgba(59, 130, 246, 0.25)',
                          border: '1px solid rgba(96, 165, 250, 0.5)',
                          color: '#93C5FD',
                          fontSize: 11,
                          fontWeight: 800,
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase'
                        }}
                      >
                        🔒 Internal AI Task Analysis &middot; Visible Only to Admin &amp; Team
                      </span>
                      <span style={{ fontSize: 12, color: '#94A3B8' }}>
                        (Never shown on Student Dashboard)
                      </span>
                    </div>

                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ background: 'rgba(255,255,255,0.1)', color: '#FFF', borderColor: 'rgba(255,255,255,0.2)' }}
                      onClick={() => handleReanalyzeTaskWithAI(selectedTask.id)}
                      disabled={reanalyzingAi}
                    >
                      {reanalyzingAi ? 'Analyzing...' : '↻ Re-Run AI Check'}
                    </button>
                  </div>

                  {selectedTask.aiReview ? (
                    <div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          flexWrap: 'wrap',
                          gap: 14,
                          padding: 16,
                          background: 'rgba(255,255,255,0.06)',
                          borderRadius: 10,
                          border: '1px solid rgba(255,255,255,0.12)',
                          marginBottom: 16
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 12, color: '#94A3B8', textTransform: 'uppercase', fontWeight: 700 }}>
                            AI Pre-Check Verdict (Is Student Result Correct?)
                          </div>
                          <div style={{ fontSize: 16.5, fontWeight: 700, color: '#FFFFFF', marginTop: 4 }}>
                            {selectedTask.aiReview.isCorrectSummary}
                          </div>
                        </div>

                        <div
                          style={{
                            padding: '10px 18px',
                            borderRadius: 10,
                            background:
                              selectedTask.aiReview.verdict === 'CORRECT'
                                ? 'rgba(16, 185, 129, 0.2)'
                                : selectedTask.aiReview.verdict === 'PARTIALLY_CORRECT'
                                  ? 'rgba(245, 158, 11, 0.2)'
                                  : 'rgba(239, 68, 68, 0.2)',
                            border: '1px solid rgba(255,255,255,0.2)',
                            textAlign: 'center'
                          }}
                        >
                          <div
                            style={{
                              fontSize: 22,
                              fontWeight: 800,
                              color:
                                selectedTask.aiReview.verdict === 'CORRECT'
                                  ? '#34D399'
                                  : selectedTask.aiReview.verdict === 'PARTIALLY_CORRECT'
                                    ? '#FBBF24'
                                    : '#F87171'
                            }}
                          >
                            {selectedTask.aiReview.accuracyScore}%
                          </div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#E2E8F0' }}>
                            {selectedTask.aiReview.verdict}
                          </div>
                        </div>
                      </div>

                      <div className="workspace-grid-2" style={{ gap: 14, marginBottom: 14 }}>
                        <div
                          style={{
                            padding: 14,
                            background: 'rgba(16, 185, 129, 0.1)',
                            border: '1px solid rgba(16, 185, 129, 0.3)',
                            borderRadius: 10
                          }}
                        >
                          <strong style={{ fontSize: 13, color: '#6EE7B7', display: 'block', marginBottom: 8 }}>
                            ✓ What the Student Got Right:
                          </strong>
                          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#E2E8F0', display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {(selectedTask.aiReview.correctPoints || []).map((pt: string, i: number) => (
                              <li key={i}>{pt}</li>
                            ))}
                          </ul>
                        </div>

                        <div
                          style={{
                            padding: 14,
                            background: 'rgba(245, 158, 11, 0.1)',
                            border: '1px solid rgba(245, 158, 11, 0.3)',
                            borderRadius: 10
                          }}
                        >
                          <strong style={{ fontSize: 13, color: '#FCD34D', display: 'block', marginBottom: 8 }}>
                            ⚠ What Needs Correction / Mentor Check:
                          </strong>
                          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#E2E8F0', display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {(selectedTask.aiReview.issuesOrCorrections || []).map((iss: string, i: number) => (
                              <li key={i}>{iss}</li>
                            ))}
                          </ul>
                        </div>
                      </div>

                      <div
                        style={{
                          padding: 12,
                          background: 'rgba(255,255,255,0.05)',
                          borderRadius: 8,
                          fontSize: 13,
                          color: '#CBD5E1',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 12,
                          flexWrap: 'wrap'
                        }}
                      >
                        <div>
                          <strong style={{ color: '#93C5FD' }}>AI Suggested Feedback for Admin:</strong>{' '}
                          {selectedTask.aiReview.suggestedAdminFeedback}
                        </div>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => setAdminReviewFeedback(selectedTask.aiReview.suggestedAdminFeedback)}
                        >
                          Use This Feedback Below
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 13.5, color: '#CBD5E1' }}>
                      No AI pre-review generated yet. Click <strong>Re-Run AI Check</strong> above once the student uploads their result.
                    </div>
                  )}
                </div>

                {/* 3. Admin Official Review Decision + Direct Student Chat Side-by-Side */}
                <div className="workspace-grid-2" style={{ alignItems: 'start' }}>
                  {/* Left: Official Admin Review & Grade */}
                  <div className="panel-card" style={{ marginBottom: 0 }}>
                    <span className="micro-tag accent">Admin Final Decision</span>
                    <h3 style={{ fontSize: 18, margin: '6px 0 10px' }}>
                      Review &amp; Approve Student Uploaded Result
                    </h3>
                    <div className="form-group">
                      <label className="form-label">Official Mentor / Admin Feedback (Visible to Student)</label>
                      <textarea
                        className="form-textarea"
                        rows={4}
                        value={adminReviewFeedback}
                        onChange={(e) => setAdminReviewFeedback(e.target.value)}
                        placeholder="Write your feedback for the student..."
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => handleSubmitAdminTaskReview(selectedTask.id, 'REVIEWED')}
                      >
                        ✓ Approve Result &amp; Mark Reviewed
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleSubmitAdminTaskReview(selectedTask.id, 'CHANGES_REQUESTED')}
                      >
                        Request Revision From Student
                      </button>
                    </div>
                  </div>

                  {/* Right: Direct Chat Between Admin/Team & Student on This Task */}
                  <div className="panel-card" style={{ marginBottom: 0 }}>
                    <span className="micro-tag accent">Direct Student Chat</span>
                    <h3 style={{ fontSize: 18, margin: '6px 0 10px' }}>
                      Chat Directly With {selectedTask.learner_name}
                    </h3>

                    <div
                      style={{
                        maxHeight: 240,
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        padding: 12,
                        background: 'var(--bg-canvas)',
                        borderRadius: 10,
                        border: '1px solid var(--border-subtle)',
                        marginBottom: 12
                      }}
                    >
                      {(selectedTask.messages || []).length === 0 ? (
                        <div style={{ fontSize: 13, color: 'var(--text-light-muted)' }}>
                          No chat messages yet. Send a message below to discuss this uploaded result with the student.
                        </div>
                      ) : (
                        (selectedTask.messages || []).map((m: any) => {
                          const isStaff = m.sender_role !== 'LEARNER';
                          return (
                            <div
                              key={m.id}
                              style={{
                                alignSelf: isStaff ? 'flex-end' : 'flex-start',
                                maxWidth: '88%',
                                padding: '10px 12px',
                                borderRadius: 10,
                                background: isStaff ? 'var(--accent)' : '#FFFFFF',
                                color: isStaff ? '#FFFFFF' : 'var(--text-main)',
                                border: isStaff ? 'none' : '1px solid var(--border-subtle)',
                                fontSize: 13
                              }}
                            >
                              <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.85, marginBottom: 3 }}>
                                {m.sender_name} &middot; {new Date(m.created_at).toLocaleTimeString()}
                              </div>
                              <div>{m.message}</div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    <form onSubmit={handleSendTaskChat} style={{ display: 'flex', gap: 8 }}>
                      <input
                        className="form-input"
                        placeholder={`Message ${selectedTask.learner_name} about their result...`}
                        value={chatMessageText}
                        onChange={(e) => setChatMessageText(e.target.value)}
                      />
                      <button type="submit" className="btn btn-primary btn-sm">
                        Send
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            ) : (
              <div className="panel-card">No student tasks found.</div>
            )}
          </div>
          </>
        )}

        {/* ===================================================================
            Courses now live on their own page. This section stays empty so a
            stale link cannot render the old combined screen.
           =================================================================== */}
        {activeTab === 'courses' && <Navigate to="/admin/courses" replace />}
        {activeTab === 'bookings' && (
          <div>
            {/* Right: Book a Call Leads (Both Direct & Post-Discovery) */}
            <div className="panel-card" style={{ marginBottom: 0 }}>
              <span className="micro-tag accent">Book a call leads &amp; consultations</span>
              <h3 style={{ fontSize: 20, margin: '10px 0 8px' }}>
                Calls on the calendar ({bookingsQuery.total.toLocaleString()})
              </h3>
              <p style={{ fontSize: 13, marginBottom: 14 }}>
                People who booked a call after Discovery, and visitors who booked straight from the website.
              </p>

              <div className="list-tools">
                <input
                  className="form-input list-search"
                  placeholder="Search name or email"
                  value={bookingQuery}
                  onChange={(e) => {
                    setBookingQuery(e.target.value);
                    setBookingPage(1);
                  }}
                  aria-label="Search bookings"
                />
                <select
                  className="form-select list-filter"
                  value={bookingStatus}
                  onChange={(e) => {
                    setBookingStatus(e.target.value);
                    setBookingPage(1);
                  }}
                  aria-label="Filter bookings by status"
                >
                  <option value="ALL">Every status</option>
                  <option value="NEW">New</option>
                  <option value="DIRECT_CALL_BOOKED">Booked directly</option>
                  <option value="CONFIRMED">Confirmed</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="NO_SHOW">No show</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
                {bookingsList.map((b: any) => (
                  <div
                    key={b.id}
                    style={{
                      padding: 15,
                      background: 'var(--bg-canvas)',
                      borderRadius: 12,
                      border: '1px solid var(--border-subtle)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                      <div>
                        <strong style={{ fontSize: 15 }}>{b.participant_name}</strong>
                        {b.learner_id && (
                          <span className="micro-tag accent" style={{ marginLeft: 8, fontSize: 10 }}>
                            From dashboard
                          </span>
                        )}
                        <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                          {b.participant_email} &middot; {b.phone || 'Phone on file'} &middot; Track:{' '}
                          <strong>
                            {b.track === 'other' ? `Other (${b.custom_track || 'self-described'})` : b.track}
                          </strong>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="micro-tag" style={{ fontSize: 10 }}>Status</span>
                        <select
                          className="form-select"
                          style={{ width: 'auto', fontSize: 12.5, padding: '6px 10px' }}
                          value={b.status}
                          aria-label={`Booking status for ${b.participant_name}`}
                          onChange={(e) => handleBookingStatus(b.id, e.target.value)}
                        >
                          {BOOKING_STATUSES.map((st) => (
                            <option key={st} value={st}>
                              {BOOKING_STATUS_LABEL[st] || st}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div
                      style={{
                        padding: '8px 12px',
                        background: '#FFFFFF',
                        borderRadius: 8,
                        border: '1px solid var(--border-subtle)',
                        fontSize: 13,
                        marginBottom: 6
                      }}
                    >
                      <strong>Call Slot:</strong> {b.preferred_date} at <strong>{b.preferred_time_slot}</strong>
                    </div>

                    {b.topic && (
                      <div style={{ fontSize: 13, marginBottom: 4 }}>
                        <strong>Topic:</strong> {b.topic}
                      </div>
                    )}
                    {b.staff_name && (
                      <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 4 }}>
                        <strong>With:</strong> {b.staff_name} ({b.staff_role === 'GUIDE' ? 'Guide' : b.staff_role})
                      </div>
                    )}
                    <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                      <strong>Focus / Result Summary:</strong> {b.result_summary}
                    </div>
                    {b.notes && (
                      <div style={{ fontSize: 12.5, color: 'var(--accent)', marginTop: 4 }}>
                        <strong>Notes:</strong> &ldquo;{b.notes}&rdquo;
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <Pager
                page={bookingsQuery.page}
                pages={bookingsQuery.pages}
                total={bookingsQuery.total}
                limit={20}
                onChange={setBookingPage}
                noun="calls"
              />
            </div>
          </div>
        )}

        {activeTab === 'leads' && (
          <>
          {/* Website Form Submissions (Leads) */}
          <div className="panel-card" style={{ marginTop: 24 }}>
            <span className="micro-tag accent">Website Form Data &middot; Leads Inbox</span>
            <h3 style={{ fontSize: 20, margin: '10px 0 8px' }}>
              Website leads ({leadsQuery.total.toLocaleString()})
            </h3>
            <p style={{ fontSize: 13, marginBottom: 14 }}>
              Every form filled on the website, with the contact details and the focus the visitor picked. Move
              one along as you work it.
            </p>

            <div className="list-tools">
              <input
                className="form-input list-search"
                placeholder="Search name, email or track"
                value={leadQuery}
                onChange={(e) => {
                  setLeadQuery(e.target.value);
                  setLeadPage(1);
                }}
                aria-label="Search leads"
              />
              <select
                className="form-select list-filter"
                value={leadStatus}
                onChange={(e) => {
                  setLeadStatus(e.target.value);
                  setLeadPage(1);
                }}
                aria-label="Filter leads by status"
              >
                <option value="ALL">Every status</option>
                <option value="NEW">New</option>
                <option value="DISCOVERY_STARTED">Discovery started</option>
                <option value="CONTACTED">Contacted</option>
                <option value="QUALIFIED">Qualified</option>
                <option value="CONVERTED">Converted</option>
                <option value="CLOSED">Closed</option>
              </select>
            </div>

            {leadsList.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                No website leads captured yet. Submissions from the public website forms will appear here automatically.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}>
                      <th style={{ padding: '8px 10px' }}>Name</th>
                      <th style={{ padding: '8px 10px' }}>Email</th>
                      <th style={{ padding: '8px 10px' }}>Track / Focus</th>
                      <th style={{ padding: '8px 10px' }}>Status</th>
                      <th style={{ padding: '8px 10px' }}>Source / Notes</th>
                      <th style={{ padding: '8px 10px' }}>Captured</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leadsList.map((lead: any) => (
                      <tr key={lead.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td style={{ padding: '9px 10px', fontWeight: 700 }}>{lead.name}</td>
                        <td style={{ padding: '9px 10px' }}>{lead.email}</td>
                        <td style={{ padding: '9px 10px' }}>
                          {lead.track === 'other' ? 'Other' : lead.track}
                          {lead.track === 'other' && lead.custom_track && (
                            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>“{lead.custom_track}”</div>
                          )}
                        </td>
                        <td style={{ padding: '9px 10px' }}>
                          <select
                            className="form-select"
                            style={{ width: 'auto', fontSize: 12, padding: '5px 8px' }}
                            value={lead.status}
                            aria-label={`Status for lead ${lead.name}`}
                            onChange={(e) => handleLeadStatus(lead.id, e.target.value)}
                          >
                            {LEAD_STATUSES.map((st) => (
                              <option key={st} value={st}>
                                {LEAD_STATUS_LABEL[st] || st}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: '9px 10px', color: 'var(--text-muted)', maxWidth: 380 }}>{lead.notes}</td>
                        <td style={{ padding: '9px 10px', color: 'var(--text-muted)' }}>
                          {lead.created_at ? new Date(lead.created_at).toLocaleString() : 'Not set'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <Pager
              page={leadsQuery.page}
              pages={leadsQuery.pages}
              total={leadsQuery.total}
              limit={20}
              onChange={setLeadPage}
              noun="leads"
            />
          </div>

            <div style={{ marginTop: 24 }}>
            {/* Left: Users Who Solved Discovery Questions + Exact Q&A Answers */}
            <div className="panel-card" style={{ marginBottom: 0 }}>
              <span className="micro-tag accent">Solved Discovery Profiles &amp; Answers</span>
              <h3 style={{ fontSize: 20, margin: '10px 0 8px' }}>
                Discovery answers ({sessionsQuery.total.toLocaleString()})
              </h3>
              <p style={{ fontSize: 13, marginBottom: 14 }}>
                Select any candidate below to view every Discovery question they solved along with their exact answers and Readiness Score.
              </p>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                {solvedSessions.map((sess: any) => {
                  const isSel = selectedSession?.id === sess.id;
                  return (
                    <button
                      key={sess.id}
                      type="button"
                      className={`btn btn-sm ${isSel ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setSelectedSessionId(sess.id)}
                    >
                      {sess.participant_name} ({sess.answeredCount} answers &middot; {sess.candidateResult?.readinessScore || 65}%)
                    </button>
                  );
                })}
              </div>

              <Pager
                page={sessionsQuery.page}
                pages={sessionsQuery.pages}
                total={sessionsQuery.total}
                limit={12}
                onChange={setSessionPage}
                noun="profiles"
              />

              {selectedSession && (
                <div
                  style={{
                    padding: 16,
                    background: 'var(--bg-canvas)',
                    borderRadius: 12,
                    border: '1px solid var(--border-subtle)'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                    <div>
                      <strong style={{ fontSize: 16 }}>{selectedSession.participant_name}</strong>
                      <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                        {selectedSession.participant_email} &middot; Track:{' '}
                        <strong>
                          {selectedSession.track === 'other'
                            ? `Other (${selectedSession.custom_track || 'self-described'})`
                            : selectedSession.track}
                        </strong>
                      </div>
                    </div>
                    <span className="status-pill info">
                      Readiness Score: {selectedSession.candidateResult?.readinessScore}% ({selectedSession.candidateResult?.readinessLabel})
                    </span>
                  </div>

                  <div style={{ fontSize: 13, marginBottom: 12, padding: 10, background: '#FFFFFF', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                    <strong>Recommended Custom Course:</strong> {selectedSession.candidateResult?.recommendedProgram}
                    <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>
                      <strong>Focus Areas for Team:</strong> {(selectedSession.candidateResult?.focusAreasForTeam || []).join(' | ')}
                    </div>
                  </div>

                  <h4 style={{ fontSize: 14, marginBottom: 8 }}>
                    Solved Questions &amp; Candidate Answers ({selectedSession.detailedAnswers?.length || 0}):
                  </h4>
                  <div style={{ maxHeight: 380, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {(selectedSession.detailedAnswers || []).map((ans: any, i: number) => (
                      <div
                        key={ans.questionId + i}
                        style={{
                          padding: '10px 12px',
                          background: '#FFFFFF',
                          borderRadius: 8,
                          border: '1px solid var(--border-subtle)',
                          fontSize: 13
                        }}
                      >
                        <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-light-muted)' }}>
                          {ans.questionId} &middot; {ans.domainTitle}
                        </div>
                        <div style={{ fontWeight: 600, color: 'var(--text-main)', margin: '2px 0 4px' }}>
                          Q: {ans.prompt}
                        </div>
                        <div style={{ color: 'var(--accent)', fontWeight: 700 }}>
                          Ans: &ldquo;{ans.answerLabel}&rdquo;
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            </div>
          </>
        )}

        {/* ===================================================================
            TAB 4: DISCOVERY QUESTION & ANSWER CONFIGURATOR (SET N & EDIT Q&A)
           =================================================================== */}
        {activeTab === 'discovery' && (
          <div className="workspace-grid-2" style={{ alignItems: 'start' }}>
            <div className="panel-card" style={{ marginBottom: 0 }}>
              <span className="micro-tag accent">Discovery Question &amp; Answer Configurator</span>
              <h3 style={{ fontSize: 20, margin: '6px 0 6px' }}>
                Configure N Discovery Questions (Active: N = {activeQuestions.length})
              </h3>
              <p style={{ fontSize: 13, marginBottom: 14 }}>
                Set how many questions (<strong>N</strong>) a candidate answers during Discovery, and click <strong>Edit Q&amp;A</strong> on any question to customize its prompt and answer choices.
              </p>

              {/* Quick N Presets */}
              <div
                style={{
                  background: 'var(--bg-canvas)',
                  padding: 14,
                  borderRadius: 10,
                  border: '1px solid var(--border-subtle)',
                  marginBottom: 16
                }}
              >
                <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>
                  Set Active Question Count (N):
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {[5, 7, 10, 12, 15, 20].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className={`btn btn-sm ${activeQuestions.length === preset ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => handleSetQuestionCountN(preset)}
                    >
                      N = {preset}
                    </button>
                  ))}
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      className="form-input"
                      style={{ width: 76, padding: '6px 10px' }}
                      value={customCountN}
                      onChange={(e) => setCustomCountN(Number(e.target.value))}
                    />
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => handleSetQuestionCountN(customCountN)}
                    >
                      Apply N
                    </button>
                  </div>
                </div>
              </div>

              {/* Inline Question & Answer Editor Modal/Card */}
              {editingQuestionId && (
                <form
                  onSubmit={handleSaveEditedQuestion}
                  style={{
                    padding: 16,
                    background: 'var(--accent-soft)',
                    border: '2px solid var(--accent)',
                    borderRadius: 12,
                    marginBottom: 16
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <strong style={{ fontSize: 14, color: 'var(--accent)' }}>
                      Editing Question &amp; Answer Options ({editingQuestionId})
                    </strong>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setEditingQuestionId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Question Prompt</label>
                    <input
                      className="form-input"
                      value={editQPrompt}
                      onChange={(e) => setEditQPrompt(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Answer Options (One per line)</label>
                    <textarea
                      className="form-textarea"
                      rows={4}
                      value={editQOptionsText}
                      onChange={(e) => setEditQOptionsText(e.target.value)}
                    />
                  </div>
                  <button type="submit" className="btn btn-primary btn-sm">
                    Save Question &amp; Answers
                  </button>
                </form>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <strong style={{ fontSize: 13.5 }}>
                  {showAllBankQuestions
                    ? `All Questions in Bank (${allQuestions.length})`
                    : `Active Discovery Questions (${activeQuestions.length})`}
                </strong>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowAllBankQuestions((v) => !v)}
                >
                  {showAllBankQuestions ? 'Show Active Only' : `Show All (${allQuestions.length})`}
                </button>
              </div>

              <div style={{ maxHeight: 420, overflowY: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 10 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Question &amp; Answer Choices</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedQuestions.map((q: any, idx: number) => (
                      <tr key={q.id}>
                        <td style={{ fontWeight: 700, fontSize: 12 }}>{idx + 1}</td>
                        <td>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{q.prompt}</div>
                          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>
                            {(q.options || []).map((o: any, i: number) => (
                              <span key={i} style={{ display: 'inline-block', marginRight: 8 }}>
                                &bull; {o.label}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td>
                          <span className={`status-pill ${q.isActive ? 'approved' : 'pending'}`}>
                            {q.isActive ? 'ACTIVE' : 'INACTIVE'}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              style={{ padding: '4px 8px', fontSize: 11.5 }}
                              onClick={() => handleStartEditQuestion(q)}
                            >
                              Edit Q&amp;A
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              style={{ padding: '4px 8px', fontSize: 11.5 }}
                              onClick={() => handleToggleQuestionActive(q)}
                            >
                              {q.isActive ? 'Disable' : 'Enable'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right: Add New Custom Discovery Question & Answer Choices */}
            <div className="panel-card" style={{ marginBottom: 0 }}>
              <span className="micro-tag accent">Add New Question &amp; Answers</span>
              <h3 style={{ fontSize: 20, margin: '10px 0 8px' }}>
                Create Custom Discovery Question &amp; Answer Options
              </h3>
              <form
                onSubmit={handleAddCustomQuestion}
                style={{
                  background: 'var(--bg-canvas)',
                  padding: 18,
                  borderRadius: 12,
                  border: '1px solid var(--border-subtle)'
                }}
              >
                <div className="form-group">
                  <label className="form-label">Question Prompt *</label>
                  <input
                    className="form-input"
                    placeholder="e.g. What is your primary goal in learning market concepts or strategies?"
                    value={newQPrompt}
                    onChange={(e) => setNewQPrompt(e.target.value)}
                    required
                  />
                </div>
                <div className="workspace-grid-2" style={{ gap: 10 }}>
                  <div className="form-group">
                    <label className="form-label">Capability Domain</label>
                    <select
                      className="form-select"
                      value={newQDomain}
                      onChange={(e) => setNewQDomain(e.target.value)}
                    >
                      <option value="PARTICIPATION_PROFILE">Market Participation &amp; Baseline</option>
                      <option value="DECISION_PROCESS">Preparation, Thesis &amp; Risk Sizing</option>
                      <option value="EXECUTION_BEHAVIOUR">Execution Under Pressure</option>
                      <option value="REVIEW_REFLECTION">Post-Decision Review</option>
                      <option value="DEVELOPMENT_GOALS">Learning Goals &amp; Open Synthesis</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Answer Input Type</label>
                    <select
                      className="form-select"
                      value={newQInputType}
                      onChange={(e) => setNewQInputType(e.target.value as any)}
                    >
                      <option value="single_choice">Multiple Choice Answers</option>
                      <option value="text">Free-Text Written Answer</option>
                    </select>
                  </div>
                </div>
                {newQInputType === 'single_choice' && (
                  <div className="form-group">
                    <label className="form-label">Answer Options (One answer option per line) *</label>
                    <textarea
                      className="form-textarea"
                      rows={4}
                      value={newQOptionsText}
                      onChange={(e) => setNewQOptionsText(e.target.value)}
                    />
                  </div>
                )}
                <button type="submit" className="btn btn-primary">
                  + Save Question &amp; Answers to Active Discovery
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ===================================================================
            TAB 5: USERS, RUBRICS & AUDIT CONSOLE
           =================================================================== */}
        {activeTab === 'learners' && <LearnersDirectory />}

        {activeTab === 'staff' && (
          <>
            <section className="panel-card">
              <span className="micro-tag accent">Access</span>
              <h3 className="admin-card-title">Staff and accounts</h3>
              <p className="admin-card-copy">
                Change a role, suspend someone, or reset a password. Every action lands in the audit
                trail. Suspending yourself is blocked so nobody locks the console by mistake.
              </p>

              <div className="admin-mini-stats">
                <span><strong>{data?.metrics?.activeGuides ?? 0}</strong> active guides</span>
                <span><strong>{data?.metrics?.activeLearners ?? 0}</strong> active learners</span>
                <span><strong>{data?.metrics?.totalUsers ?? 0}</strong> accounts in total</span>
              </div>

              <div className="list-tools">
                <input
                  className="form-input list-search"
                  placeholder="Search name or email"
                  value={staffQueryText}
                  onChange={(e) => {
                    setStaffQueryText(e.target.value);
                    setStaffPage(1);
                  }}
                  aria-label="Search accounts"
                />
                <select
                  className="form-select list-filter"
                  value={staffRole}
                  onChange={(e) => {
                    setStaffRole(e.target.value);
                    setStaffPage(1);
                  }}
                  aria-label="Filter by role"
                >
                  <option value="ALL">Every role</option>
                  <option value="LEARNER">Learners</option>
                  <option value="GUIDE">Guides</option>
                  <option value="ADMIN">Admins</option>
                  <option value="CURRICULUM_OWNER">Curriculum owners</option>
                </select>
              </div>

              <div className="admin-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staffList.map((u: any) => (
                      <tr key={u.id}>
                        <td>
                          <strong>{u.name}</strong>
                          {u.id === user?.id && <span className="admin-you"> you</span>}
                        </td>
                        <td className="admin-muted">{u.email}</td>
                        <td>
                          {u.id === user?.id ? (
                            <span className="micro-tag accent" style={{ fontSize: 10 }}>{u.role}</span>
                          ) : (
                            <select
                              className="form-select"
                              style={{ width: 'auto', fontSize: 12, padding: '5px 8px' }}
                              value={u.role}
                              aria-label={`Role for ${u.name}`}
                              onChange={(e) => handleRoleChange(u, e.target.value)}
                            >
                              <option value="LEARNER">Student</option>
                              <option value="GUIDE">Guide</option>
                              <option value="CURRICULUM_OWNER">Curriculum Owner</option>
                              <option value="ADMIN">Administrator</option>
                            </select>
                          )}
                        </td>
                        <td>
                          <span className={`micro-tag ${u.account_status === 'ACTIVE' ? 'success' : 'danger'}`} style={{ fontSize: 10 }}>
                            {u.account_status === 'ACTIVE' ? 'Active' : 'Suspended'}
                          </span>
                        </td>
                        <td>
                          <div className="admin-row-actions">
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => handleResetPassword(u)}
                            >
                              <KeyRound size={13} /> Reset password
                            </button>
                            {u.id !== user?.id && (
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => handleToggleUserStatus(u)}
                              >
                                {u.account_status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Pager
                page={staffQuery.page}
                pages={staffQuery.pages}
                total={staffQuery.total}
                limit={20}
                onChange={setStaffPage}
                noun="accounts"
              />
            </section>

            <section className="panel-card">
              <span className="micro-tag accent">New account</span>
              <h3 className="admin-card-title">Create a staff or learner account</h3>
              <p className="admin-card-copy">
                A random password is generated and shown once. Pass it on, and ask them to change it
                after their first sign-in.
              </p>

              <form onSubmit={handleProvisionUser} className="admin-form">
                <div className="admin-form-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="newStaffName">Full name</label>
                    <input
                      id="newStaffName"
                      className="form-input"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="e.g. Ananya Deshmukh"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="newStaffEmail">Email</label>
                    <input
                      id="newStaffEmail"
                      className="form-input"
                      type="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      placeholder="e.g. ananya@frins.in"
                      required
                    />
                  </div>
                </div>

                <div className="admin-form-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="newStaffRole">Role</label>
                    <select
                      id="newStaffRole"
                      className="form-select"
                      value={newRole}
                      onChange={(e) => setNewRole(e.target.value as any)}
                    >
                      <option value="LEARNER">Student</option>
                      <option value="GUIDE">Guide</option>
                      <option value="CURRICULUM_OWNER">Curriculum Owner</option>
                      <option value="ADMIN">Administrator</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="newStaffTrack">Learning track</label>
                    <select
                      id="newStaffTrack"
                      className="form-select"
                      value={newTrack}
                      onChange={(e) => setNewTrack(e.target.value)}
                    >
                      <option value="student_concepts">Student concepts</option>
                      <option value="strategy_learner">Strategy learner</option>
                      <option value="trader">Trader</option>
                      <option value="investor">Investor</option>
                      <option value="both">Both</option>
                    </select>
                  </div>
                </div>

                <button type="submit" className="btn btn-primary">
                  Create account
                </button>
              </form>
            </section>
          </>
        )}

        {activeTab === 'progress' && (
          <LearnerProgress courses={coursesList} authFetch={authFetch} onChanged={loadAdminOverview} />
        )}

        {activeTab === 'notifications' && <AdminNotifications />}

        {activeTab === 'settings' && (
          <div className="admin-split">
            <div>
              <section className="panel-card">
                <span className="micro-tag accent">Your account</span>
                <h3 className="admin-card-title">Update your password</h3>
                <p className="admin-card-copy">
                  You stay signed in here. Any other device signed in as you is signed out.
                </p>

                <form onSubmit={handleChangeOwnPassword} className="admin-form">
                  <div className="form-group">
                    <label className="form-label" htmlFor="ownCurrent">Current password</label>
                    <input
                      id="ownCurrent"
                      type="password"
                      className="form-input"
                      autoComplete="current-password"
                      value={ownCurrentPassword}
                      onChange={(e) => setOwnCurrentPassword(e.target.value)}
                      required
                    />
                  </div>
                  <div className="admin-form-row">
                    <div className="form-group">
                      <label className="form-label" htmlFor="ownNew">New password</label>
                      <input
                        id="ownNew"
                        type="password"
                        className="form-input"
                        autoComplete="new-password"
                        value={ownNewPassword}
                        onChange={(e) => setOwnNewPassword(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="ownConfirm">New password again</label>
                      <input
                        id="ownConfirm"
                        type="password"
                        className="form-input"
                        autoComplete="new-password"
                        value={ownConfirmPassword}
                        onChange={(e) => setOwnConfirmPassword(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  {passwordError && <div className="admin-inline-error">{passwordError}</div>}

                  <button type="submit" className="btn btn-primary" disabled={passwordBusy}>
                    {passwordBusy ? 'Updating...' : 'Update password'}
                  </button>
                </form>
              </section>

              <section className="panel-card">
                <span className="micro-tag accent">Competency library</span>
                <h3 className="admin-card-title">Rubrics and versions</h3>
                <div className="admin-comp-list">
                  {(data?.competencies || []).map((c: any) => (
                    <div key={c.code} className="admin-comp-item">
                      <div className="admin-comp-head">
                        <strong>{c.code} · {c.title}</strong>
                        <span className="micro-tag accent" style={{ fontSize: 10 }}>v{c.rubric_version}</span>
                      </div>
                      <p className="admin-muted">{c.description}</p>
                    </div>
                  ))}
                </div>

                <form onSubmit={handleUpdateRubric} className="admin-form admin-form-tight">
                  <div className="admin-form-row">
                    <div className="form-group">
                      <label className="form-label" htmlFor="rubricCode">Competency code</label>
                      <input
                        id="rubricCode"
                        className="form-input"
                        value={compCode}
                        onChange={(e) => setCompCode(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="rubricVersion">New version</label>
                      <input
                        id="rubricVersion"
                        className="form-input"
                        value={rubricVer}
                        onChange={(e) => setRubricVer(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="rubricTitle">Title</label>
                    <input
                      id="rubricTitle"
                      className="form-input"
                      value={compTitle}
                      onChange={(e) => setCompTitle(e.target.value)}
                      required
                    />
                  </div>
                  <button type="submit" className="btn btn-dark btn-sm">
                    Publish rubric version
                  </button>
                </form>
              </section>
            </div>

            <section className="panel-card">
              <span className="micro-tag accent">Audit trail</span>
              <h3 className="admin-card-title">Every change, in order</h3>
              <p className="admin-card-copy">Read only. Nothing here can be edited or deleted.</p>

              <div className="list-tools">
                <input
                  className="form-input list-search"
                  placeholder="Search action, user or record"
                  value={auditQuery}
                  onChange={(e) => {
                    setAuditQuery(e.target.value);
                    setAuditPage(1);
                  }}
                  aria-label="Search audit trail"
                />
              </div>

              <div className="admin-audit">
                {auditList.map((ev: any) => (
                  <div key={ev.id} className="admin-audit-row">
                    <div>
                      <strong>{ev.action.replaceAll('_', ' ').toLowerCase()}</strong>
                      <small>{ev.entity_type}: {ev.entity_id}</small>
                    </div>
                    <div className="admin-audit-meta">
                      <span className="micro-tag" style={{ fontSize: 10 }}>{ev.actor_role}</span>
                      <small>{new Date(ev.created_at).toLocaleString()}</small>
                    </div>
                  </div>
                ))}
                {auditList.length === 0 && <p className="admin-muted">Nothing recorded yet.</p>}
              </div>

              <Pager
                page={auditQueryList.page}
                pages={auditQueryList.pages}
                total={auditQueryList.total}
                limit={25}
                onChange={setAuditPage}
                noun="events"
              />
            </section>
          </div>
        )}
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(confirmState)}
        title={confirmState?.title || ''}
        message={confirmState?.message || ''}
        confirmLabel={confirmState?.confirmLabel}
        variant={confirmState?.variant || 'danger'}
        busy={confirmBusy}
        onCancel={() => {
          if (!confirmBusy) setConfirmState(null);
        }}
        onConfirm={async () => {
          if (!confirmState) return;
          setConfirmBusy(true);
          try {
            await confirmState.run();
          } finally {
            setConfirmBusy(false);
            setConfirmState(null);
          }
        }}
      />
    </div>
  );
};
