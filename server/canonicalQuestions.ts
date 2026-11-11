export interface CanonicalQuestionOption {
  value: string;
  label: string;
  signalTag?: string;
}

export interface CanonicalQuestion {
  id: string; // Q01 .. Q34
  number: number;
  domain:
    | 'PARTICIPATION_ORIENTATION'
    | 'DECISION_PROCESS'
    | 'RISK_EXECUTION'
    | 'REFLECTION_EVIDENCE'
    | 'GOALS_BOUNDARIES';
  domainTitle: string;
  prompt: string;
  subtext: string;
  type: 'single_choice' | 'scale' | 'open_reflection';
  required: boolean;
  options?: CanonicalQuestionOption[];
  placeholder?: string;
}

export const QUESTION_BANK_VERSION = '1.0.0-canonical-34';

export const CANONICAL_QUESTIONS: CanonicalQuestion[] = [
  // =========================================================================
  // DOMAIN 1: PARTICIPATION & MARKET ORIENTATION (Q01 - Q06)
  // =========================================================================
  {
    id: 'Q01',
    number: 1,
    domain: 'PARTICIPATION_ORIENTATION',
    domainTitle: '1. Participation & Market Orientation',
    prompt: 'How do you primarily participate in financial markets today?',
    subtext: 'Select the orientation that best describes most of your market decisions.',
    type: 'single_choice',
    required: true,
    options: [
      { value: 'trader', label: 'Active Trader (Intraday, swing, or short-term positional decisions)', signalTag: 'track:trader' },
      { value: 'investor', label: 'Long-Term Investor (Multi-quarter or multi-year capital allocation)', signalTag: 'track:investor' },
      { value: 'both', label: 'Dual Participant (Maintain both an active trading book and a long-term portfolio)', signalTag: 'track:both' },
      { value: 'exploring', label: 'Early-Stage / Preparing (Observing markets and building foundational understanding)', signalTag: 'track:exploring' }
    ]
  },
  {
    id: 'Q02',
    number: 2,
    domain: 'PARTICIPATION_ORIENTATION',
    domainTitle: '1. Participation & Market Orientation',
    prompt: 'Which instruments represent the majority of your market activity?',
    subtext: 'This helps your Learning Guide understand the volatility and structural mechanics you face.',
    type: 'single_choice',
    required: true,
    options: [
      { value: 'cash_equities', label: 'Direct Cash Equities / Stocks' },
      { value: 'derivatives_fno', label: 'Index or Stock Futures & Options (F&O)' },
      { value: 'etfs_funds_equities', label: 'Long-Term Equities, ETFs & Diversified Funds' },
      { value: 'multi_asset', label: 'Commodities, FX, or Multi-Asset Combinations' }
    ]
  },
  {
    id: 'Q03',
    number: 3,
    domain: 'PARTICIPATION_ORIENTATION',
    domainTitle: '1. Participation & Market Orientation',
    prompt: 'How long have you been actively making your own market decisions?',
    subtext: 'Experience length does not automatically imply process maturity; there is no right or wrong answer.',
    type: 'single_choice',
    required: true,
    options: [
      { value: 'under_1y', label: 'Less than 1 year' },
      { value: '1_to_3y', label: '1 to 3 years' },
      { value: '3_to_7y', label: '3 to 7 years' },
      { value: 'over_7y', label: 'More than 7 years' }
    ]
  },
  {
    id: 'Q04',
    number: 4,
    domain: 'PARTICIPATION_ORIENTATION',
    domainTitle: '1. Participation & Market Orientation',
    prompt: 'What is your typical decision holding timeframe?',
    subtext: 'Think about your actual holding period rather than your intended holding period.',
    type: 'single_choice',
    required: true,
    options: [
      { value: 'intraday', label: 'Minutes to hours (Closed within the same session)' },
      { value: 'days_weeks', label: 'Several days to a few weeks (Swing / Positional)' },
      { value: 'months_quarters', label: 'Several months to a few quarters' },
      { value: 'multi_year', label: 'Multiple years (Long-term compounding)' }
    ]
  },
  {
    id: 'Q05',
    number: 5,
    domain: 'PARTICIPATION_ORIENTATION',
    domainTitle: '1. Participation & Market Orientation',
    prompt: 'How separated are your trading and long-term investment decisions in practice?',
    subtext: 'A common point of friction is turning a losing short-term trade into an unplanned "long-term investment".',
    type: 'single_choice',
    required: true,
    options: [
      { value: 'strictly_separated', label: 'Strictly separated with distinct accounts, rules, and capital buckets' },
      { value: 'mostly_separated', label: 'Mostly separated, though boundaries occasionally blur under stress' },
      { value: 'frequently_blurred', label: 'Blurred: short-term trades sometimes become long-term holds if they go against me' },
      { value: 'single_approach', label: 'I only use one approach (exclusively trading or exclusively investing)' }
    ]
  },
  {
    id: 'Q06',
    number: 6,
    domain: 'PARTICIPATION_ORIENTATION',
    domainTitle: '1. Participation & Market Orientation',
    prompt: 'When do you conduct most of your market preparation and analysis?',
    subtext: 'Preparation timing often determines how reactive decisions feel during market hours.',
    type: 'single_choice',
    required: true,
    options: [
      { value: 'structured_off_market', label: 'Outside market hours using a repeatable checklist before the bell' },
      { value: 'just_before_open', label: 'Shortly before market open or intermittently during the week' },
      { value: 'during_live_hours', label: 'Mostly during live market hours while prices are moving' },
      { value: 'ad_hoc_news', label: 'Whenever an interesting idea, screen alert, or headline appears' }
    ]
  },

  // =========================================================================
  // DOMAIN 2: DECISION-MAKING & PROCESS STRUCTURE (Q07 - Q13)
  // =========================================================================
  {
    id: 'Q07',
    number: 7,
    domain: 'DECISION_PROCESS',
    domainTitle: '2. Decision-Making & Process Structure',
    prompt: 'How clearly defined is your decision process before committing capital?',
    subtext: 'Consider whether another person could read your criteria and understand what qualifies a decision.',
    type: 'single_choice',
    required: true,
    options: [
      { value: 'written_and_followed', label: 'Written down clearly and followed consistently before every decision' },
      { value: 'written_loosely_followed', label: 'Written down, but I often rely on intuition or bend criteria in real time' },
      { value: 'mental_framework', label: 'Kept in my head as general principles rather than written criteria' },
      { value: 'no_fixed_process', label: 'I currently try different approaches depending on recent results or market mood' }
    ]
  },
  {
    id: 'Q08',
    number: 8,
    domain: 'DECISION_PROCESS',
    domainTitle: '2. Decision-Making & Process Structure',
    prompt: 'Before entering a trade or investment, do you write down why you are taking it and what would invalidate your view?',
    subtext: 'Pre-commitment helps distinguish original reasoning from post-hoc rationalisation.',
    type: 'single_choice',
    required: true,
    options: [
      { value: 'always_pre_recorded', label: 'Yes: thesis and invalidation point are written before entry' },
      { value: 'sometimes_recorded', label: 'Sometimes: usually for larger positions, skipped on smaller or faster ones' },
      { value: 'mental_note_only', label: 'I note it mentally but rarely write it down before acting' },
      { value: 'rarely_defined', label: 'Rarely: I focus mainly on the upside opportunity first' }
    ]
  },
  {
    id: 'Q09',
    number: 9,
    domain: 'DECISION_PROCESS',
    domainTitle: '2. Decision-Making & Process Structure',
    prompt: 'How do you handle conflicting information, commentary, or social media noise once you have formed a view?',
    subtext: 'External opinions can either inform research or destabilise conviction.',
    type: 'single_choice',
    required: true,
    options: [
      { value: 'filtered_by_rules', label: 'I evaluate new facts against my written thesis and ignore unverified commentary' },
      { value: 'causes_hesitation', label: 'Conflicting commentary often makes me second-guess or exit early' },
      { value: 'triggers_fomo', label: 'Strong opinions from others occasionally pull me into unplanned positions' },
      { value: 'avoid_external_noise', label: 'I deliberately limit external feeds during decision windows' }
    ]
  },
  {
    id: 'Q10',
    number: 10,
    domain: 'DECISION_PROCESS',
    domainTitle: '2. Decision-Making & Process Structure',
    prompt: 'How do you determine how much capital to allocate to a single trade or investment?',
    subtext: 'Position sizing connects belief in an idea with survival when wrong.',
    type: 'single_choice',
    required: true,
    options: [
      { value: 'risk_defined_formula', label: 'Calculated from pre-defined risk per decision or portfolio allocation caps' },
      { value: 'fixed_equal_amounts', label: 'Roughly equal rupee/capital amounts per position' },
      { value: 'conviction_feeling', label: 'Sized mainly by how confident I feel at that moment' },
      { value: 'inconsistent_sizing', label: 'Varies widely depending on recent wins, losses, or available cash' }
    ]
  },
  {
    id: 'Q11',
    number: 11,
    domain: 'DECISION_PROCESS',
    domainTitle: '2. Decision-Making & Process Structure',
    prompt: 'Are your exit conditions (both for taking profit/rebalancing and for cutting a loss) decided before you enter?',
    subtext: 'Deciding exits in the middle of price fluctuations carries very different pressure than deciding beforehand.',
    type: 'single_choice',
    required: true,
    options: [
      { value: 'always_pre_defined', label: 'Yes: both downside exit and review/target conditions are set in advance' },
      { value: 'downside_only', label: 'Downside exit is set in advance; upside is managed dynamically' },
      { value: 'decided_in_flight', label: 'I mostly decide how to exit after watching how the price behaves' },
      { value: 'no_clear_exit_plan', label: 'Exits are my hardest area: I often hold too long or exit impulsively' }
    ]
  },
  {
    id: 'Q12',
    number: 12,
    domain: 'DECISION_PROCESS',
    domainTitle: '2. Decision-Making & Process Structure',
    prompt: 'How frequently do you switch strategies, setups, or analytical frameworks?',
    subtext: 'Changing methods after a few losing outcomes can prevent gathering meaningful evidence on any single process.',
    type: 'single_choice',
    required: true,
    options: [
      { value: 'stable_framework', label: 'My core framework has remained consistent; I refine small parts deliberately' },
      { value: 'periodic_shifts', label: 'I adjust frameworks every few months when market regimes feel different' },
      { value: 'frequent_switching', label: 'I often look for a new indicator, setup, or method after a rough patch' },
      { value: 'still_building_first', label: 'I am still working toward assembling my first cohesive framework' }
    ]
  },
  {
    id: 'Q13',
    number: 13,
    domain: 'DECISION_PROCESS',
    domainTitle: '2. Decision-Making & Process Structure',
    prompt: 'How regularly do you conduct a structured review of your past decisions?',
    subtext: 'Reviewing only P&L statements is different from reviewing decision quality.',
    type: 'single_choice',
    required: true,
    options: [
      { value: 'scheduled_deep_review', label: 'On a fixed weekly/monthly schedule, comparing execution against my plan' },
      { value: 'occasional_review', label: 'Occasionally, mostly when a particularly big win or loss stands out' },
      { value: 'pnl_check_only', label: 'I check account P&L regularly, but rarely review the reasoning behind decisions' },
      { value: 'avoid_looking_back', label: 'I rarely review past decisions, especially after drawdowns' }
    ]
  },

  // =========================================================================
  // DOMAIN 3: RISK, UNCERTAINTY & EXECUTION UNDER PRESSURE (Q14 - Q20)
  // =========================================================================
  {
    id: 'Q14',
    number: 14,
    domain: 'RISK_EXECUTION',
    domainTitle: '3. Risk, Uncertainty & Execution Under Pressure',
    prompt: 'When a position moves sharply against your expectation and reaches your invalidation level, what usually happens?',
    subtext: 'Reflect honestly on your last 5–10 adverse situations rather than your ideal rule.',
    type: 'single_choice',
    required: true,
    options: [
      { value: 'execute_exit_cleanly', label: 'I execute the planned exit or reduction without delay' },
      { value: 'hesitate_wait_bounce', label: 'I pause and hope for a pullback before exiting, often taking a larger loss' },
      { value: 'widen_or_average_down', label: 'I sometimes move my stop-loss further away or add more to lower my average price' },
      { value: 'freeze_and_hold', label: 'I stop watching or hold indefinitely until it eventually recovers' }
    ]
  },
  {
    id: 'Q15',
    number: 15,
    domain: 'RISK_EXECUTION',
    domainTitle: '3. Risk, Uncertainty & Execution Under Pressure',
    prompt: 'How strictly do you respect your maximum loss limit for a single position or single day/month?',
    subtext: 'This helps cross-check how well intended risk rules hold up under live market stress.',
    type: 'single_choice',
    required: true,
    options: [
      { value: 'strict_non_negotiable', label: 'Strictly non-negotiable: I never exceed my pre-set risk limit' },
      { value: 'mostly_respected', label: 'Respected most of the time, with rare exceptions in volatile markets' },
      { value: 'often_stretched', label: 'Often stretched when I feel strongly that the market will turn around' },
      { value: 'no_defined_limit', label: 'I do not currently use a fixed numeric risk cap' }
    ]
  },
  {
    id: 'Q16',
    number: 16,
    domain: 'RISK_EXECUTION',
    domainTitle: '3. Risk, Uncertainty & Execution Under Pressure',
    prompt: 'After experiencing two or three consecutive losses (or a painful portfolio drawdown), how does your next decision typically change?',
    subtext: 'Consecutive setbacks often trigger either excessive caution or urgency to "make it back".',
    type: 'single_choice',
    required: true,
    options: [
      { value: 'process_unchanged', label: 'My process remains steady, or I deliberately step back for a planned cool-down' },
      { value: 'urge_to_recover_fast', label: 'I feel urgency to win back the loss quickly, sometimes trading more frequently or larger' },
      { value: 'excessive_hesitation', label: 'I become overly hesitant and skip valid opportunities that meet my criteria' },
      { value: 'abandon_current_rules', label: 'I start doubting my entire approach and look for completely new criteria' }
    ]
  },
  {
    id: 'Q17',
    number: 17,
    domain: 'RISK_EXECUTION',
    domainTitle: '3. Risk, Uncertainty & Execution Under Pressure',
    prompt: 'After a strong winning streak or a highly profitable decision, what pattern do you notice most in yourself?',
    subtext: 'Success can quietly loosen risk discipline just as much as drawdowns.',
    type: 'single_choice',
    required: true,
    options: [
      { value: 'maintain_same_discipline', label: 'I maintain the same checklist and position sizing rules' },
      { value: 'overconfidence_larger_size', label: 'I tend to increase size prematurely or take looser setups with less preparation' },
      { value: 'fear_of_giving_back', label: 'I become anxious about giving back gains and exit future winners too early' },
      { value: 'not_observed', label: 'I have not tracked how winning streaks affect my subsequent decisions' }
    ]
  },
  {
    id: 'Q18',
    number: 18,
    domain: 'RISK_EXECUTION',
    domainTitle: '3. Risk, Uncertainty & Execution Under Pressure',
    prompt: 'When markets move rapidly (gap opens, macro announcements, sharp volatility spikes), how do you respond?',
    subtext: 'Fast markets compress decision time and amplify emotional impulses.',
    type: 'single_choice',
    required: true,
    options: [
      { value: 'follow_volatility_protocol', label: 'I rely on pre-planned levels or step aside if conditions fall outside my playbook' },
      { value: 'impulsive_chasing', label: 'I sometimes jump in late out of fear of missing a big move' },
      { value: 'panic_exit', label: 'Sharp swings often cause me to exit sound positions prematurely' },
      { value: 'overwhelmed_freeze', label: 'I feel overwhelmed by conflicting signals and struggle to act clearly' }
    ]
  },
  {
    id: 'Q19',
    number: 19,
    domain: 'RISK_EXECUTION',
    domainTitle: '3. Risk, Uncertainty & Execution Under Pressure',
    prompt: 'When a position is in profit and moving in your favour, what is your most common challenge?',
    subtext: 'Managing favourable moves is often just as revealing as managing losses.',
    type: 'single_choice',
    required: true,
    options: [
      { value: 'follow_planned_exit', label: 'I follow my planned scaling or thesis-completion rules calmly' },
      { value: 'cut_winners_tiny', label: 'I lock in small profits quickly out of fear the gain will disappear' },
      { value: 'move_targets_greed', label: 'I keep extending targets without structure and sometimes round-trip the gain into a loss' },
      { value: 'add_top_heavy_risk', label: 'I add aggressively near the top without recalculating total downside risk' }
    ]
  },
  {
    id: 'Q20',
    number: 20,
    domain: 'RISK_EXECUTION',
    domainTitle: '3. Risk, Uncertainty & Execution Under Pressure',
    prompt: 'In the past month, how often have you deviated from a rule you told yourself you would follow?',
    subtext: 'Honest observation of rule adherence is a cornerstone of the FRINS conversation.',
    type: 'single_choice',
    required: true,
    options: [
      { value: 'rarely_or_never', label: 'Rarely or never: my execution closely matches my stated rules' },
      { value: 'occasionally_under_stress', label: '1–2 times, typically during high-stress market sessions' },
      { value: 'frequently_deviate', label: 'Frequently: knowing what to do and doing it in live markets feel far apart' },
      { value: 'no_written_rules_yet', label: 'I do not yet have formal written rules to measure deviation against' }
    ]
  },

  // =========================================================================
  // DOMAIN 4: REFLECTION, EVIDENCE & SELF-ASSESSMENT (Q21 - Q27)
  // =========================================================================
  {
    id: 'Q21',
    number: 21,
    domain: 'REFLECTION_EVIDENCE',
    domainTitle: '4. Reflection, Evidence & Self-Assessment',
    prompt: 'If a decision breaks your rules but still makes money, how do you classify it?',
    subtext: 'Separating process quality from outcome luck is critical for sustainable development.',
    type: 'single_choice',
    required: true,
    options: [
      { value: 'poor_process_lucky_outcome', label: 'As a process failure that happened to have a lucky outcome: requiring review' },
      { value: 'mixed_feelings', label: 'I know it broke rules, but the profit makes me overlook the mistake' },
      { value: 'good_intuition', label: 'As proof that my instinct was right to override the rule' },
      { value: 'profit_is_what_matters', label: 'If it made money, I consider it a successful decision' }
    ]
  },
  {
    id: 'Q22',
    number: 22,
    domain: 'REFLECTION_EVIDENCE',
    domainTitle: '4. Reflection, Evidence & Self-Assessment',
    prompt: 'What kind of records or evidence do you currently keep of your market decisions?',
    subtext: 'Evidence allows you and your Guide to examine patterns objectively rather than relying on memory.',
    type: 'single_choice',
    required: true,
    options: [
      { value: 'comprehensive_journal', label: 'Detailed decision journal (entry thesis, risk, chart/notes, emotional state, post-exit review)' },
      { value: 'spreadsheet_log', label: 'Basic spreadsheet of entries, exits, and numbers with brief notes' },
      { value: 'broker_statements_only', label: 'Only my broker contract notes / P&L history' },
      { value: 'no_records_kept', label: 'I do not currently maintain structured records' }
    ]
  },
  {
    id: 'Q23',
    number: 23,
    domain: 'REFLECTION_EVIDENCE',
    domainTitle: '4. Reflection, Evidence & Self-Assessment',
    prompt: 'Do you track your internal state (fatigue, distraction, frustration, urgency) alongside your market decisions?',
    subtext: 'Many execution errors happen under predictable personal conditions rather than market surprises.',
    type: 'single_choice',
    required: true,
    options: [
      { value: 'actively_tracked', label: 'Yes: I explicitly note my state before and during decision sessions' },
      { value: 'aware_in_hindsight', label: 'I notice it in hindsight after a mistake, but rarely check before acting' },
      { value: 'rarely_considered', label: 'I focus almost entirely on charts/financials and rarely track my own state' },
      { value: 'unsure_how_to_track', label: 'I know emotions affect me, but I lack a simple way to observe them' }
    ]
  },
  {
    id: 'Q24',
    number: 24,
    domain: 'REFLECTION_EVIDENCE',
    domainTitle: '4. Reflection, Evidence & Self-Assessment',
    prompt: 'When you notice a recurring mistake in your decisions, how do you typically respond?',
    subtext: 'Consider how you attempt to solve friction points once they become visible.',
    type: 'single_choice',
    required: true,
    options: [
      { value: 'design_specific_drill', label: 'I isolate the single friction point and practice a specific constraint or routine' },
      { value: 'tell_myself_try_harder', label: 'I resolve to "be more disciplined next time" without changing my workflow' },
      { value: 'consume_more_content', label: 'I watch more videos, read books, or search for a better technical strategy' },
      { value: 'take_unstructured_break', label: 'I pause briefly out of frustration and then return to the same habits' }
    ]
  },
  {
    id: 'Q25',
    number: 25,
    domain: 'REFLECTION_EVIDENCE',
    domainTitle: '4. Reflection, Evidence & Self-Assessment',
    prompt: 'How comfortable are you sitting in cash or doing nothing when market conditions do not match your understanding?',
    subtext: 'Restraint is an active market competency.',
    type: 'single_choice',
    required: true,
    options: [
      { value: 'very_comfortable_patient', label: 'Very comfortable: I have no problem waiting until clarity aligns with my criteria' },
      { value: 'somewhat_restless', label: 'I can wait briefly, but prolonged inactivity makes me force marginal decisions' },
      { value: 'feel_need_for_action', label: 'I feel like I am falling behind if I am not actively positioned in the market' },
      { value: 'always_fully_exposed', label: 'I stay fully positioned almost all the time regardless of conditions' }
    ]
  },
  {
    id: 'Q26',
    number: 26,
    domain: 'REFLECTION_EVIDENCE',
    domainTitle: '4. Reflection, Evidence & Self-Assessment',
    prompt: 'Looking across your last 10 market decisions, how many were taken strictly according to a pre-defined plan?',
    subtext: 'This quantitative check grounds earlier process questions in recent concrete evidence.',
    type: 'single_choice',
    required: true,
    options: [
      { value: '8_to_10_planned', label: '8 to 10 out of 10 (High consistency between plan and action)' },
      { value: '5_to_7_planned', label: '5 to 7 out of 10 (Moderate consistency; several unplanned actions)' },
      { value: '2_to_4_planned', label: '2 to 4 out of 10 (Majority were reactive or improvised)' },
      { value: '0_to_1_planned', label: '0 to 1 out of 10 (Decisions were made without a pre-defined plan)' }
    ]
  },
  {
    id: 'Q27',
    number: 27,
    domain: 'REFLECTION_EVIDENCE',
    domainTitle: '4. Reflection, Evidence & Self-Assessment',
    prompt: 'How clearly can you explain your current edge or investment philosophy in three sentences?',
    subtext: 'Clarity of expression often reflects clarity of thought.',
    type: 'single_choice',
    required: true,
    options: [
      { value: 'clear_and_tested', label: 'Very clearly: backed by my own historical evidence and review logs' },
      { value: 'conceptually_clear_execution_gap', label: 'Conceptually clear, though my real-world execution does not always reflect it' },
      { value: 'still_borrowing_others', label: 'It is mostly a blend of ideas borrowed from different educators or analysts' },
      { value: 'cannot_articulate_yet', label: 'I cannot articulate a clear personal approach yet' }
    ]
  },

  // =========================================================================
  // DOMAIN 5: LEARNING GOALS, EXPECTATIONS & BOUNDARIES (Q28 - Q34)
  // =========================================================================
  {
    id: 'Q28',
    number: 28,
    domain: 'GOALS_BOUNDARIES',
    domainTitle: '5. Learning Goals, Expectations & Boundaries',
    prompt: 'What is the primary outcome you are hoping to get from FRINS?',
    subtext: 'FRINS is built around understanding, process, and human-guided development. Never tips or calls.',
    type: 'single_choice',
    required: true,
    options: [
      { value: 'build_personal_process', label: 'Understand my own decision patterns and build a disciplined, repeatable market process' },
      { value: 'bridge_execution_gap', label: 'Close the gap between what I know in theory and how I execute under real pressure' },
      { value: 'structured_review_guidance', label: 'Have an objective human Guide review my evidence and refine my existing framework' },
      { value: 'seeking_stock_tips_signals', label: 'Receive actionable stock tips, buy/sell signals, or guaranteed return strategies' }
    ]
  },
  {
    id: 'Q29',
    number: 29,
    domain: 'GOALS_BOUNDARIES',
    domainTitle: '5. Learning Goals, Expectations & Boundaries',
    prompt: 'How do you feel about having a human Learning Guide ask probing questions about your losing decisions and habits?',
    subtext: 'The 45-minute FRINS Conversation is supportive and non-judgmental, but requires honest reflection.',
    type: 'single_choice',
    required: true,
    options: [
      { value: 'welcome_honest_mirror', label: 'I welcome it: an honest, objective mirror is exactly what I need' },
      { value: 'open_but_slightly_guarded', label: 'Open to it, though discussing past losses feels somewhat uncomfortable' },
      { value: 'prefer_autonomous_study', label: 'I prefer mostly self-directed reflection with light check-ins' },
      { value: 'only_want_market_calls', label: 'I do not want to discuss my process; I only want market calls' }
    ]
  },
  {
    id: 'Q30',
    number: 30,
    domain: 'GOALS_BOUNDARIES',
    domainTitle: '5. Learning Goals, Expectations & Boundaries',
    prompt: 'How much time per week can you realistically commit to structured reflection, journaling, and deliberate practice?',
    subtext: 'A Personalised Development Plan (PDP) is shaped around your realistic life schedule.',
    type: 'single_choice',
    required: true,
    options: [
      { value: 'under_2_hours', label: '1 to 2 hours per week (Focused weekend review)' },
      { value: '3_to_5_hours', label: '3 to 5 hours per week (Regular post-session routines)' },
      { value: '6_to_10_hours', label: '6 to 10 hours per week (Dedicated daily preparation and review)' },
      { value: 'over_10_hours', label: 'More than 10 hours per week (Full-time or intensive commitment)' }
    ]
  },
  {
    id: 'Q31',
    number: 31,
    domain: 'GOALS_BOUNDARIES',
    domainTitle: '5. Learning Goals, Expectations & Boundaries',
    prompt: 'Do you currently experience any significant concern or friction in your market approach, or do you feel your process is already well-governed?',
    subtext: 'FRINS does not manufacture problems. If your process is already sound, we acknowledge that honestly.',
    type: 'single_choice',
    required: true,
    options: [
      { value: 'clear_friction_present', label: 'Yes: I have specific recurring friction points in process, risk, or execution' },
      { value: 'moderate_refinement_needed', label: 'My foundation is decent, but I want structured refinement and accountability' },
      { value: 'uncertain_where_gap_is', label: 'Results are inconsistent and I am not entirely sure what is holding me back' },
      { value: 'no_major_concern_sound_process', label: 'My process, risk rules, and review habits are already steady and working well' }
    ]
  },
  {
    id: 'Q32',
    number: 32,
    domain: 'GOALS_BOUNDARIES',
    domainTitle: '5. Learning Goals, Expectations & Boundaries',
    prompt: 'In your own words, describe a recent market decision that felt difficult, frustrating, or revealing.',
    subtext: 'Do not include confidential account numbers. Focus on what you were thinking before, during, and after.',
    type: 'open_reflection',
    required: true,
    placeholder: 'Example: Last month I identified a clear setup with a defined stop, but when price dropped rapidly in the first 20 minutes I widened my stop twice instead of exiting...'
  },
  {
    id: 'Q33',
    number: 33,
    domain: 'GOALS_BOUNDARIES',
    domainTitle: '5. Learning Goals, Expectations & Boundaries',
    prompt: 'What is the single most valuable shift you would like to see in how you approach the market over the next 90 days?',
    subtext: 'This helps anchor your 1-on-1 conversation with your Learning Guide.',
    type: 'open_reflection',
    required: true,
    placeholder: 'Example: I want to follow a written pre-market checklist and stop taking impulsive trades after a losing morning...'
  },
  {
    id: 'Q34',
    number: 34,
    domain: 'GOALS_BOUNDARIES',
    domainTitle: '5. Learning Goals, Expectations & Boundaries',
    prompt: 'Governance & Consent: Do you understand that FRINS is strictly an educational ecosystem (not financial advice) and consent to human Guide review assisted by governed AI observation?',
    subtext: 'AI proposes initial observations from your responses; a human Learning Guide reviews all context with you.',
    type: 'single_choice',
    required: true,
    options: [
      { value: 'consented_full', label: 'Yes: I understand FRINS boundaries and consent to Guide + governed AI observation review' },
      { value: 'consented_human_only', label: 'Yes: I understand FRINS boundaries and prefer human Guide review only' }
    ]
  }
];

export interface ContradictionFlag {
  code: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  questionIds: string[];
  description: string;
}

export interface DeterministicDiscoveryEvaluation {
  questionBankVersion: string;
  totalCanonicalQuestions: number;
  answeredCount: number;
  completenessPct: number;
  isComplete: boolean;
  missingQuestionIds: string[];
  contradictionFlags: ContradictionFlag[];
  sufficiencyStatus: 'SUFFICIENT' | 'INSUFFICIENT' | 'CONFLICTING' | 'REVIEW_REQUIRED';
  exitPathway:
    | 'PROCEED_TO_GUIDE_CONVERSATION'
    | 'CLARIFICATION_NEEDED'
    | 'NO_CONCERN_ESTABLISHED'
    | 'BOUNDARY_REDIRECT'
    | 'PENDING';
  noConcernEstablished: boolean;
  domainBreakdown: Record<
    string,
    {
      domainTitle: string;
      answered: number;
      total: number;
      frictionScore: number; // 0 (low friction / strong process) to 100 (high friction)
      summaryNote: string;
    }
  >;
}

/**
 * Deterministic rule engine for evaluating Discovery responses.
 * Enforces Requirement 3, 6.2, 8, and 11:
 * - Hard rules for completeness, contradiction checks, sufficiency, and permitted exits.
 * - Never invents a problem where evidence shows a steady, well-governed process.
 */
export function evaluateDiscoverySessionDeterministically(
  responsesMap: Record<string, { answerValue: string; answerText?: string }>
): DeterministicDiscoveryEvaluation {
  const totalCanonicalQuestions = CANONICAL_QUESTIONS.length;
  const missingQuestionIds: string[] = [];

  for (const q of CANONICAL_QUESTIONS) {
    const r = responsesMap[q.id];
    const val = (r?.answerValue || r?.answerText || '').trim();
    if (!val) {
      missingQuestionIds.push(q.id);
    }
  }

  const answeredCount = totalCanonicalQuestions - missingQuestionIds.length;
  const completenessPct = Math.round((answeredCount / totalCanonicalQuestions) * 100);
  const isComplete = missingQuestionIds.length === 0;

  const valOf = (qId: string) => (responsesMap[qId]?.answerValue || responsesMap[qId]?.answerText || '').trim();

  // 1. Deterministic Contradiction Rules
  const contradictionFlags: ContradictionFlag[] = [];

  // Rule C1: Claims written & strictly followed process (Q07) but reports low plan adherence in last 10 decisions (Q26)
  if (
    valOf('Q07') === 'written_and_followed' &&
    (valOf('Q26') === '2_to_4_planned' || valOf('Q26') === '0_to_1_planned')
  ) {
    contradictionFlags.push({
      code: 'CONTRADICTION_PROCESS_VS_RECENT_10',
      severity: 'HIGH',
      questionIds: ['Q07', 'Q26'],
      description:
        'Participant reported having a written process followed consistently before every decision (Q07), but indicated only 0–4 of their last 10 decisions followed a pre-defined plan (Q26).'
    });
  }

  // Rule C2: Claims non-negotiable risk limit (Q15) or pre-defined exits (Q11) but widens stop / averages down / freezes on adverse move (Q14)
  if (
    (valOf('Q15') === 'strict_non_negotiable' || valOf('Q11') === 'always_pre_defined') &&
    (valOf('Q14') === 'widen_or_average_down' || valOf('Q14') === 'freeze_and_hold')
  ) {
    contradictionFlags.push({
      code: 'CONTRADICTION_RISK_RULE_VS_ADVERSE_ACTION',
      severity: 'HIGH',
      questionIds: ['Q11', 'Q14', 'Q15'],
      description:
        'Participant stated strict pre-defined risk/exit rules (Q11/Q15), yet reported widening stops, averaging down, or holding indefinitely when price reaches invalidation (Q14).'
    });
  }

  // Rule C3: Claims comprehensive journal (Q22) but rarely checks or avoids reviewing past decisions (Q13)
  if (
    valOf('Q22') === 'comprehensive_journal' &&
    (valOf('Q13') === 'pnl_check_only' || valOf('Q13') === 'avoid_looking_back')
  ) {
    contradictionFlags.push({
      code: 'CONTRADICTION_JOURNAL_VS_REVIEW_CADENCE',
      severity: 'MEDIUM',
      questionIds: ['Q13', 'Q22'],
      description:
        'Participant reported keeping a comprehensive decision journal (Q22) while also reporting checking only P&L or avoiding post-decision reviews (Q13).'
    });
  }

  // Rule C4: Claims rare/never rule deviation (Q20) but reports frequent impulsive chasing or urge to recover losses rapidly (Q16/Q18)
  if (
    valOf('Q20') === 'rarely_or_never' &&
    (valOf('Q16') === 'urge_to_recover_fast' || valOf('Q18') === 'impulsive_chasing')
  ) {
    contradictionFlags.push({
      code: 'CONTRADICTION_ADHERENCE_VS_STRESS_IMPULSE',
      severity: 'MEDIUM',
      questionIds: ['Q16', 'Q18', 'Q20'],
      description:
        'Participant stated rarely or never deviating from rules (Q20), but reported urgency to win back losses rapidly (Q16) or impulsive chasing in fast markets (Q18).'
    });
  }

  // Rule C5: Open reflection (Q32/Q33) is extremely brief (< 15 chars) despite completion
  const q32Len = valOf('Q32').length;
  const q33Len = valOf('Q33').length;
  const openTextTooShort = isComplete && (q32Len < 15 || q33Len < 15);

  // 2. Domain Friction & Pattern Calculation
  const highConsistencySignals = [
    valOf('Q07') === 'written_and_followed',
    valOf('Q08') === 'always_pre_recorded',
    valOf('Q10') === 'risk_defined_formula',
    valOf('Q11') === 'always_pre_defined',
    valOf('Q13') === 'scheduled_deep_review',
    valOf('Q14') === 'execute_exit_cleanly',
    valOf('Q15') === 'strict_non_negotiable',
    valOf('Q16') === 'process_unchanged',
    valOf('Q20') === 'rarely_or_never',
    valOf('Q21') === 'poor_process_lucky_outcome',
    valOf('Q22') === 'comprehensive_journal',
    valOf('Q26') === '8_to_10_planned',
    valOf('Q31') === 'no_major_concern_sound_process'
  ].filter(Boolean).length;

  const noConcernEstablished =
    isComplete &&
    contradictionFlags.length === 0 &&
    highConsistencySignals >= 9 &&
    valOf('Q31') === 'no_major_concern_sound_process' &&
    valOf('Q28') !== 'seeking_stock_tips_signals';

  // 3. Determine Sufficiency Status & Exit Pathway
  let sufficiencyStatus: DeterministicDiscoveryEvaluation['sufficiencyStatus'] = 'INSUFFICIENT';
  let exitPathway: DeterministicDiscoveryEvaluation['exitPathway'] = 'PENDING';

  if (!isComplete) {
    sufficiencyStatus = 'INSUFFICIENT';
    exitPathway = 'PENDING';
  } else if (valOf('Q28') === 'seeking_stock_tips_signals' || valOf('Q29') === 'only_want_market_calls') {
    sufficiencyStatus = 'REVIEW_REQUIRED';
    exitPathway = 'BOUNDARY_REDIRECT';
  } else if (contradictionFlags.some((f) => f.severity === 'HIGH')) {
    sufficiencyStatus = 'CONFLICTING';
    exitPathway = 'CLARIFICATION_NEEDED';
  } else if (openTextTooShort || contradictionFlags.length > 0) {
    sufficiencyStatus = 'REVIEW_REQUIRED';
    exitPathway = 'CLARIFICATION_NEEDED';
  } else if (noConcernEstablished) {
    sufficiencyStatus = 'SUFFICIENT';
    exitPathway = 'NO_CONCERN_ESTABLISHED';
  } else {
    sufficiencyStatus = 'SUFFICIENT';
    exitPathway = 'PROCEED_TO_GUIDE_CONVERSATION';
  }

  // Domain breakdown summaries
  const domains = [
    { key: 'PARTICIPATION_ORIENTATION', title: '1. Participation & Market Orientation', qIds: ['Q01', 'Q02', 'Q03', 'Q04', 'Q05', 'Q06'] },
    { key: 'DECISION_PROCESS', title: '2. Decision-Making & Process Structure', qIds: ['Q07', 'Q08', 'Q09', 'Q10', 'Q11', 'Q12', 'Q13'] },
    { key: 'RISK_EXECUTION', title: '3. Risk, Uncertainty & Execution Under Pressure', qIds: ['Q14', 'Q15', 'Q16', 'Q17', 'Q18', 'Q19', 'Q20'] },
    { key: 'REFLECTION_EVIDENCE', title: '4. Reflection, Evidence & Self-Assessment', qIds: ['Q21', 'Q22', 'Q23', 'Q24', 'Q25', 'Q26', 'Q27'] },
    { key: 'GOALS_BOUNDARIES', title: '5. Learning Goals, Expectations & Boundaries', qIds: ['Q28', 'Q29', 'Q30', 'Q31', 'Q32', 'Q33', 'Q34'] }
  ];

  const domainBreakdown: DeterministicDiscoveryEvaluation['domainBreakdown'] = {};

  for (const d of domains) {
    const answered = d.qIds.filter((id) => valOf(id).length > 0).length;
    let frictionPoints = 0;
    for (const qId of d.qIds) {
      const q = CANONICAL_QUESTIONS.find((item) => item.id === qId);
      const v = valOf(qId);
      if (q && q.options && v) {
        const idx = q.options.findIndex((o) => o.value === v);
        if (idx > 0) {
          frictionPoints += idx * 30;
        }
      }
    }
    const maxFriction = d.qIds.length * 90;
    const frictionScore = answered > 0 ? Math.min(100, Math.round((frictionPoints / maxFriction) * 100)) : 0;

    let summaryNote = 'Awaiting full domain responses.';
    if (answered === d.qIds.length) {
      if (frictionScore <= 22) {
        summaryNote = 'Evidence indicates structured habits and steady self-governance in this domain.';
      } else if (frictionScore <= 55) {
        summaryNote = 'Conceptual structure exists, with situational execution or consistency gaps worth exploring in conversation.';
      } else {
        summaryNote = 'Notable recurring friction reported; high-priority exploration area for the Learning Guide conversation.';
      }
    }

    domainBreakdown[d.key] = {
      domainTitle: d.title,
      answered,
      total: d.qIds.length,
      frictionScore,
      summaryNote
    };
  }

  return {
    questionBankVersion: QUESTION_BANK_VERSION,
    totalCanonicalQuestions,
    answeredCount,
    completenessPct,
    isComplete,
    missingQuestionIds,
    contradictionFlags,
    sufficiencyStatus,
    exitPathway,
    noConcernEstablished,
    domainBreakdown
  };
}

/**
 * Realistic Pre-Built Personas for one-click Discovery testing & evaluation
 */
export const DISCOVERY_TEST_PERSONAS: Record<
  string,
  {
    label: string;
    description: string;
    participantName: string;
    participantEmail: string;
    track: 'trader' | 'investor' | 'both';
    answers: Record<string, string>;
  }
> = {
  active_trader_friction: {
    label: 'Persona A: Active Trader with Execution Friction (Sufficient → Guide Review)',
    description:
      'Understands chart setups and risk theory, but hesitates on stops during volatile sessions and overtrades after morning losses.',
    participantName: 'Aarav Mehta',
    participantEmail: 'aarav@example.com',
    track: 'trader',
    answers: {
      Q01: 'trader',
      Q02: 'derivatives_fno',
      Q03: '1_to_3y',
      Q04: 'intraday',
      Q05: 'mostly_separated',
      Q06: 'just_before_open',
      Q07: 'written_loosely_followed',
      Q08: 'sometimes_recorded',
      Q09: 'causes_hesitation',
      Q10: 'conviction_feeling',
      Q11: 'downside_only',
      Q12: 'periodic_shifts',
      Q13: 'occasional_review',
      Q14: 'hesitate_wait_bounce',
      Q15: 'often_stretched',
      Q16: 'urge_to_recover_fast',
      Q17: 'overconfidence_larger_size',
      Q18: 'impulsive_chasing',
      Q19: 'cut_winners_tiny',
      Q20: 'frequently_deviate',
      Q21: 'mixed_feelings',
      Q22: 'spreadsheet_log',
      Q23: 'aware_in_hindsight',
      Q24: 'tell_myself_try_harder',
      Q25: 'somewhat_restless',
      Q26: '5_to_7_planned',
      Q27: 'conceptually_clear_execution_gap',
      Q28: 'bridge_execution_gap',
      Q29: 'welcome_honest_mirror',
      Q30: '3_to_5_hours',
      Q31: 'clear_friction_present',
      Q32: 'Last Tuesday I took a planned index breakout trade with a 25-point stop. When the candle reversed sharply against me in 5 minutes, I cancelled my stop order hoping for a bounce and ended up losing three times my planned risk.',
      Q33: 'I want to build an unbreakable pre-trade risk checklist and stop taking impulsive recovery trades after a red morning.',
      Q34: 'consented_full'
    }
  },
  steady_investor_no_concern: {
    label: 'Persona B: Steady Long-Term Investor ("No Concern Established" Pathway)',
    description:
      'Demonstrates written investment checklists, disciplined position sizing, regular quarterly reviews, and reports no major friction.',
    participantName: 'Rohan Verma',
    participantEmail: 'rohan@example.com',
    track: 'investor',
    answers: {
      Q01: 'investor',
      Q02: 'etfs_funds_equities',
      Q03: 'over_7y',
      Q04: 'multi_year',
      Q05: 'strictly_separated',
      Q06: 'structured_off_market',
      Q07: 'written_and_followed',
      Q08: 'always_pre_recorded',
      Q09: 'filtered_by_rules',
      Q10: 'risk_defined_formula',
      Q11: 'always_pre_defined',
      Q12: 'stable_framework',
      Q13: 'scheduled_deep_review',
      Q14: 'execute_exit_cleanly',
      Q15: 'strict_non_negotiable',
      Q16: 'process_unchanged',
      Q17: 'maintain_same_discipline',
      Q18: 'follow_volatility_protocol',
      Q19: 'follow_planned_exit',
      Q20: 'rarely_or_never',
      Q21: 'poor_process_lucky_outcome',
      Q22: 'comprehensive_journal',
      Q23: 'actively_tracked',
      Q24: 'design_specific_drill',
      Q25: 'very_comfortable_patient',
      Q26: '8_to_10_planned',
      Q27: 'clear_and_tested',
      Q28: 'structured_review_guidance',
      Q29: 'welcome_honest_mirror',
      Q30: '3_to_5_hours',
      Q31: 'no_major_concern_sound_process',
      Q32: 'During the recent mid-cap correction, one of my holdings reported margin compression that violated my pre-written thesis. I reviewed the quarterly filing over the weekend and exited calmly on Monday according to my allocation policy.',
      Q33: 'My current process is steady and well-documented; I am mainly interested in periodic peer/Guide dialogue to keep my thesis review sharp.',
      Q34: 'consented_full'
    }
  },
  contradictory_participant: {
    label: 'Persona C: Conflicting Evidence Case (Contradiction Detector → Clarification Needed)',
    description:
      'Claims strict written rules and non-negotiable risk caps, yet reports widening stops, averaging down losers, and only 2–4 planned decisions out of 10.',
    participantName: 'Kabir Sharma',
    participantEmail: 'kabir@example.com',
    track: 'both',
    answers: {
      Q01: 'both',
      Q02: 'cash_equities',
      Q03: '3_to_7y',
      Q04: 'days_weeks',
      Q05: 'frequently_blurred',
      Q06: 'during_live_hours',
      Q07: 'written_and_followed',
      Q08: 'always_pre_recorded',
      Q09: 'triggers_fomo',
      Q10: 'risk_defined_formula',
      Q11: 'always_pre_defined',
      Q12: 'frequent_switching',
      Q13: 'avoid_looking_back',
      Q14: 'widen_or_average_down',
      Q15: 'strict_non_negotiable',
      Q16: 'urge_to_recover_fast',
      Q17: 'overconfidence_larger_size',
      Q18: 'impulsive_chasing',
      Q19: 'move_targets_greed',
      Q20: 'rarely_or_never',
      Q21: 'good_intuition',
      Q22: 'comprehensive_journal',
      Q23: 'rarely_considered',
      Q24: 'consume_more_content',
      Q25: 'feel_need_for_action',
      Q26: '2_to_4_planned',
      Q27: 'still_borrowing_others',
      Q28: 'build_personal_process',
      Q29: 'open_but_slightly_guarded',
      Q30: '1_to_2_hours',
      Q31: 'uncertain_where_gap_is',
      Q32: 'I always follow strict stop losses, except when a good stock drops 8% intraday and I double my position to bring my average price down and hold it for a few months.',
      Q33: 'I want more consistent monthly returns and to understand why my swing trades keep getting stuck in drawdowns.',
      Q34: 'consented_full'
    }
  }
};
