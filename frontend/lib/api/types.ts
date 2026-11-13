export interface ScheduleVersion {
  id: number;
  name: string;
  valid_from: string;
  valid_until: string;
  is_active: boolean;
  lessons_count?: number;
}

export interface ScheduleVersionMutation {
  name?: string;
  valid_from?: string;
  valid_until?: string;
  is_active?: boolean;
}

export type WeekType = "numerator" | "denominator" | "both";

export type AcademicEventType = "exam" | "consultation" | "credit" | "defense" | "general";

export interface AcademicEvent {
  id: number;
  group_id: number;
  group_name?: string | null;
  subject_id?: number | null;
  subject_name?: string | null;
  custom_subject?: string | null;
  teacher_id?: number | null;
  teacher_name?: string | null;
  title?: string | null;
  event_type: AcademicEventType;
  event_date: string;
  lesson_number?: number | null;
  start_time: string;
  end_time?: string | null;
  room?: string | null;
  note?: string | null;
}

export interface SemesterStartSetting {
  value: string;
}

export interface SemesterDatesSetting {
  semester_start: string | null;
  semester_end: string | null;
  configured: boolean;
}

export interface SemesterDatesUpdate {
  semester_start: string;
  semester_end: string;
}

export type LearningMode = "offline" | "online";

export interface LearningModeOverride {
  start: string;
  end: string;
  mode: LearningMode;
  courses: number[];
  reason?: string | null;
}

export interface LearningModeConfig {
  cycle_start: string | null;
  weeks_per_phase: number;
  first_phase_offline_courses: number[];
  overrides: LearningModeOverride[];
}

export interface DirectoryItem {
  id: number;
  name: string;
  disabled?: boolean;
}

export type ReferenceResource = "faculties" | "groups" | "teachers" | "subjects";

export interface ReferenceRecord extends DirectoryItem {
  full_name?: string | null;
  short_name?: string | null;
  faculty_id?: number | null;
  curator_id?: number | null;
  year_of_admission?: number | null;
  email?: string | null;
  room?: string | null;
  room_override?: string | null;
  is_active: boolean;
  course?: number | null;
}

export type ReferenceMutation = Omit<Partial<ReferenceRecord>, "id" | "is_active"> & { name: string };

export interface Lesson {
  group_id?: number;
  id: number;
  lesson_number: number;
  time: string;
  subject: string;
  subject_id: number;
  teacher_id: number | null;
  second_teacher_id: number | null;
  stream_id?: string | null;
  day_of_week: number;
  teacher: string | null;
  room: string | null;
  room_override?: string | null;
  teacher_room?: string | null;
  second_teacher_room?: string | null;
  subject_name: string;
  teacher_name: string | null;
  week_type: WeekType;
  is_replacement?: boolean;
  is_cancelled?: boolean;
  is_relevant_this_week: boolean;
  group_name?: string;
  note: string | null;
  note_id?: number | null;
  note_revision?: number;
  note_date?: string | null;
  event_type?: string | null;
  event_title?: string | null;
  custom_subject?: string | null;
  event_id?: number | null;
  moved_to_date?: string | null;
  moved_to_lesson?: number | null;
  effective_from?: string | null;
  effective_until?: string | null;
  version_id?: number | null;
  has_template?: boolean;
  is_online?: boolean;
  has_protected_link?: boolean;
}

export interface ShortenedDayItem {
  date: string;
  reason?: string | null;
}

export interface SchedulePeriodInfo {
  id: number;
  name: string;
  period_type: "theory" | "session" | "practice" | "holiday" | "diploma" | "attestation" | string;
  start_date: string;
  end_date: string;
}

export interface ScheduleResponse {
  date: string;
  week_type: WeekType;
  lessons: Lesson[];
  learning_mode?: LearningMode | null;
  learning_mode_override?: LearningModeOverride | null;
  is_shortened_day?: boolean;
  period_info?: SchedulePeriodInfo | null;
}

export interface TemplateDaySchedule {
  day_of_week: number;
  name: string;
  lessons: Lesson[];
}

export interface TemplateScheduleResponse {
  version: ScheduleVersion;
  week_type: WeekType;
  effective_from: string;
  days: TemplateDaySchedule[];
  all_lessons: Lesson[];
}

export interface StatisticsEntry {
  id: number;
  name: string;
  completed_hours: number;
  planned_hours: number | null;
  progress_percent: number | null;
  notes_count?: number;
  cancelled_count?: number;
  replaced_count?: number;
  subject_names?: string[];
}

export interface TeacherSubjectEntry {
  id: number;
  name: string;
  completed_hours: number;
  lessons_count: number;
  groups: string[];
}

export interface TeacherGroupDetail {
  id: number;
  name: string;
  completed_hours: number;
  lessons_count: number;
  subject_names: string[];
}

export interface StatisticsResponse {
  mode: "student" | "teacher";
  semester_start: string;
  through_date: string;
  total_hours: number;
  planned_hours: number | null;
  weekly_hours?: number | null;
  entries: StatisticsEntry[];
  subjects?: TeacherSubjectEntry[] | null;
  groups?: TeacherGroupDetail[] | null;
}

export interface AuthUser {
  id: number;
  username: string;
  email: string | null;
  name: string;
  role: "admin" | "editor" | "viewer" | string;
  is_active: boolean;
  allowed_groups?: number[];
}

export interface AuthSession {
  access_token: string;
  refresh_token?: string | null;
  token_type: "bearer";
  user: AuthUser;
}

export interface LessonMutation {
  group_id?: number;
  date?: string;
  day_of_week?: number;
  subject_id?: number;
  teacher_id?: number | null;
  second_teacher_id?: number | null;
  lesson_number: number;
  subject?: string;
  teacher?: string | null;
  room?: string | null;
  room_override?: string | null;
  week_type: WeekType;
  is_replacement?: boolean;
  version_id?: number | null;
}

export interface TermCourseScheduleRecord {
  id: number;
  term_id: number;
  course: number;
  total_weeks: number;
  practice_weeks: number;
  practice_timing: "START" | "MIDDLE" | "END" | "NONE";
  practice_start_week?: number | null;
  practice_end_week?: number | null;
  theory_weeks: number;
}

export interface TermCourseScheduleInput {
  id?: number;
  term_id?: number;
  course: number;
  total_weeks: number;
  practice_weeks: number;
  practice_timing: "START" | "MIDDLE" | "END" | "NONE";
  practice_start_week?: number | null;
  practice_end_week?: number | null;
  theory_weeks: number;
}

export interface AcademicTermRecord {
  id: number;
  name: string;
  academic_year: string;
  semester_number: number;
  start_date: string;
  end_date: string;
  total_weeks: number;
  is_current: boolean;
  status: "ACTIVE" | "PLANNING" | "ARCHIVED";
  created_at: string;
  course_schedules: TermCourseScheduleRecord[];
}

export interface AcademicTermMutation {
  name?: string;
  academic_year?: string;
  semester_number?: number;
  start_date?: string;
  end_date?: string;
  total_weeks?: number;
  is_current?: boolean;
  status?: "ACTIVE" | "PLANNING" | "ARCHIVED";
  course_schedules?: TermCourseScheduleInput[];
}

export interface WorkloadCalculationResult {
  theory_weeks: number;
  total_hours: number;
  pairs_per_2_weeks: number;
}

export interface CurriculumRecord {
  id: number;
  term_id?: number | null;
  group_id: number;
  subject_id: number;
  teacher_id: number;
  second_teacher_id: number | null;
  pairs_per_2_weeks: number;
  total_hours: number;
  is_stream: boolean;
  is_fixed: boolean;
  stream_id: string | null;
  strict_day: number | null;
  strict_lesson: number | null;
  require_week: string | null;
  allow_multiple_per_day: boolean;
  group: { id: number; name: string };
  subject: { id: number; name: string };
  teacher: { id: number; name: string; room?: string | null };
  second_teacher: { id: number; name: string; room?: string | null } | null;
}

export interface CurriculumMutation {
  term_id?: number | null;
  group_id: number;
  subject_id: number;
  teacher_id: number;
  second_teacher_id?: number | null;
  pairs_per_2_weeks: number;
  total_hours: number;
  is_stream: boolean;
  stream_id?: string | null;
  is_fixed: boolean;
  strict_day?: number | null;
  strict_lesson?: number | null;
  require_week?: string | null;
  allow_multiple_per_day?: boolean;
}

export interface ImporterReport {
  unresolved: { type: string; raw: string; actual_id?: number }[];
  substitutions: ImportSubstitution[];
  cancelled: ImportCancellation[];
  base_slots: any[];
  unresolved_substitutions?: Array<Record<string, unknown>>;
  skipped_base_slots?: Array<Record<string, unknown>>;
  restored_base_slots?: any[];
  debug?: {
    pages_fetched: number;
    unique_page_urls: number;
    unique_page_hashes: number;
    raw_lessons: number;
    raw_base_slots: number;
    raw_substitutions: number;
    raw_cancelled: number;
    deduplicated_base_slots: number;
    deduplicated_substitutions: number;
    deduplicated_cancelled: number;
    filtered_substitutions: number;
    filtered_cancelled: number;
    final_substitutions: number;
    final_cancelled: number;
    page_snapshots: Array<{
      group_id: string | number;
      url: string;
      html_hash: string;
      dates: string[];
      week_type: string;
    }>;
  };
}

export interface ImportSubstitution {
  date: string;
  lesson_number: number;
  group_id: number;
  subject_id: number;
  teacher_id: number;
  second_teacher_id?: number | null;
  room?: string | null;
  is_explicit_substitution?: boolean;
  is_equal_to_base?: boolean;
  change_type?: "substitution" | "swap" | "move" | "none";
  is_swap?: boolean;
  swap_with_lesson?: number | null;
  is_move?: boolean;
  moved_from_lesson?: number | null;
  note?: string | null;
}

export interface ImportCancellation {
  date: string;
  lesson_number: number;
  group_id: number;
}

export interface ImporterResponse {
  status: string;
  groups_processed: number;
  report: ImporterReport;
  meta?: {
    draft_created?: number | null;
    unchanged?: boolean;
    reason?: string;
    auto_published?: boolean;
    published_id?: number | null;
    anomaly_detected?: boolean;
    is_anomaly?: boolean;
    anomaly_reasons?: string[];
    skipped_reverted?: number;
    skipped_manual?: number;
    out_of_version?: number;
  };
}

export interface AliasMutation {
  entity_type: string;
  parsed_name: string;
  actual_id: number;
}

export interface CurriculumDeduplicateResult {
  merged_subjects: number;
  renamed_subjects: number;
  removed_curriculums: number;
  affected_groups: number;
}

export type SchedulePeriodType = "practice" | "holiday" | "session" | "diploma" | "attestation" | "theory";

export interface SchedulePeriodSlotMutation {
  group_id: number;
  subject_id: number;
  teacher_id: number;
  second_teacher_id?: number | null;
  day_of_week: number;
  lesson_number: number;
  room_override?: string | null;
}

export interface SchedulePeriodSlotRecord extends SchedulePeriodSlotMutation {
  id: number;
  group: DirectoryItem;
  subject: DirectoryItem;
  teacher: DirectoryItem;
  second_teacher: DirectoryItem | null;
}

export interface SchedulePeriodRecord {
  id: number;
  name: string;
  period_type: SchedulePeriodType;
  start_date: string;
  end_date: string;
  groups: DirectoryItem[];
  slots: SchedulePeriodSlotRecord[];
}

export interface SchedulePeriodMutation {
  name: string;
  period_type: SchedulePeriodType;
  start_date: string;
  end_date: string;
  group_ids: number[];
  slots: SchedulePeriodSlotMutation[];
}

export interface DraftSlotRecord {
  id: number;
  draft_id: number;
  day_of_week: number;
  lesson_number: number;
  week_type: string;
  room_override: string | null;
  is_locked: boolean;
  curriculum: CurriculumRecord;
}

export interface DraftSubstitutionRecord {
  kind: "substitution" | "cancelled";
  date: string;
  day_of_week: number;
  week_type: string;
  lesson_number: number;
  group_id: number;
  group_name: string | null;
  subject_name: string | null;
  teacher_name: string | null;
  room: string | null;
  teacher_id: number | null;
  second_teacher_id: number | null;
}

export interface GeneratorPriorities {
  teacher_windows: number;
  late_start: number;
  three_consecutive_days: number;
  subject_week_balance: number;
  group_week_balance: number;
  soft_teacher_constraints: number;
  teacher_active_day: number;
  teacher_single_lesson_day: number;
  teacher_four_lessons_day: number;
  subject_slot_symmetry: number;
  shared_room_conflict: number;
  curator_thursday_priority: number;
}

export interface GeneratorSettings {
  max_time_seconds: number;
  optimization_time_seconds: number;
  hint_mode: "previous" | "fresh";
  priorities: GeneratorPriorities;
}

export interface GeneratorRunOptions {
  max_time_seconds?: number;
  optimization_time_seconds?: number;
  hint_mode?: "previous" | "fresh";
  priorities?: Partial<GeneratorPriorities>;
}

export interface DraftQualityReport {
  quality_score: number;
  symmetry_percent: number;
  first_lesson_start_percent: number;
  methodical_days_count: number;
  teacher_windows: Array<{
    teacher_id: number;
    teacher_name: string;
    day_of_week: number;
    week_type: "numerator" | "denominator";
    empty_lessons: number[];
    is_double: boolean;
  }>;
  late_starts: Array<{
    group_id: number;
    group_name: string;
    day_of_week: number;
    week_type: "numerator" | "denominator";
    start_lesson: number;
  }>;
  teacher_single_pair_days?: Array<{
    teacher_id: number;
    teacher_name: string;
    day_of_week: number;
    week_type: "numerator" | "denominator";
    lesson_number: number;
  }>;
  soft_constraint_violations: Array<{
    teacher_id: number;
    teacher_name: string;
    group_id: number;
    group_name: string;
    subject_name: string;
    day_of_week: number;
    week_type: "numerator" | "denominator";
    lesson_number: number;
  }>;
  room_conflicts: Array<{
    room: string;
    day_of_week: number;
    week_type: "numerator" | "denominator";
    lesson_number: number;
    groups: string[];
  }>;
}

export interface DraftGenerationSummary {
  settings?: GeneratorSettings;
  weights?: Record<string, number>;
  status?: string;
  objective?: number | null;
  elapsed_seconds?: number;
  hints_used?: number;
  phase?: "validating" | "feasibility" | "optimizing" | "saving" | "completed" | "failed" | string;
  progress_percent?: number;
  solutions_found?: number;
  started_at?: string;
  diagnostics?: string[];
  quality?: DraftQualityReport | null;
}

export interface DraftRecord {
  id: number;
  name: string;
  draft_type: "import" | "generated";
  status: string;
  created_at: string;
  revision: number;
  generation?: DraftGenerationSummary | null;
  data?: {
    substitutions?: ImportSubstitution[];
    cancelled?: ImportCancellation[];
    generation?: DraftGenerationSummary;
  } | null;
}

export interface TeacherConstraintRecord {
  id: number;
  teacher_id: number;
  day_of_week: number;
  lesson_number: number;
  is_hard_constraint: boolean;
  teacher: { id: number; name: string };
}

export interface ImportStatusResponse {
  settings: {
    auto_publish: boolean;
    anomaly_group_threshold: number;
    anomaly_total_threshold: number;
  };
  last_publication: {
    id: number;
    timestamp: string;
    source: string;
    changes_count: number;
    is_reverted: boolean;
  } | null;
  last_check?: {
    checked_at: string;
    source: string;
    status: "published" | "unchanged" | "anomaly" | "draft" | "error";
    changes_count: number;
    publication_id?: number | null;
    error_message?: string | null;
  } | null;
  pending_anomaly_draft: {
    id: number;
    name: string;
    changes_count: number;
    anomaly_reasons: string[];
    auto_publish_skipped_reason?: string | null;
    created_at: string | null;
  } | null;
  latest_pending_draft?: {
    id: number;
    name: string;
    changes_count: number;
    is_anomaly: boolean;
    anomaly_reasons: string[];
    auto_publish_skipped_reason?: string | null;
    created_at: string | null;
  } | null;
  anomaly_drafts_count: number;
  active_notification: {
    id: string;
    publication_id: number;
    source: string;
    created_at: string;
    changes_count: number;
    replacements_count?: number;
    swaps_count?: number;
    urgent: boolean;
    dismissed: boolean;
    dates?: string[];
  } | null;
}

export interface PublicationChangeItem {
  group_id: number;
  group_name: string;
  date: string;
  lesson_number: number;
  kind: string;
  change_type?: string;
  is_swap?: boolean;
  before: string;
  after: string;
}

export interface ImportSettingsUpdate {
  auto_publish?: boolean;
  anomaly_group_threshold?: number;
  anomaly_total_threshold?: number;
}

export interface OccurrenceNote {
  id: number;
  group_id: number;
  note_date: string;
  lesson_number: number;
  subject_id: number;
  note: string;
  revision: number;
  archived: boolean;
}

export interface NoteRevision {
  note_id: number;
  revision: number;
  event: string;
  snapshot: {
    note: string;
    subject_name: string;
    note_date: string;
    lesson_number: number;
    archived: boolean;
    actor_name?: string | null;
  };
  created_at: string;
}

export interface ClassroomWorkerHeartbeat {
  last_started_at?: string | null;
  last_finished_at?: string | null;
  checked_groups?: number;
  processed?: number[];
  errors?: Array<{ group_id: number; error: string }>;
  force?: boolean;
  duration_ms?: number;
  next_interval_s?: number;
  next_run_at?: string | null;
}

export interface ClassroomGroupRosterResponse {
  course_name: string | null;
  last_synced_at: string | null;
  connected_accounts_count?: number;
  total_accounts_count?: number;
  has_subgroups?: boolean;
  subgroup_warning?: string | null;
  sync_in_progress?: boolean;
  group_backoff_until?: string | null;
  worker_heartbeat?: ClassroomWorkerHeartbeat | null;
  accounts?: ClassroomAccountStat[];
  students: Array<{ id: number; full_name: string; email?: string | null; photo_url?: string | null }>;
}

export interface ClassroomAccountStat {
  id: number;
  google_user_id: string;
  email?: string | null;
  student_name?: string | null;
  photo_url?: string | null;
  subgroup?: number | null;
  last_synced_at: string | null;
  last_error: string | null;
  fail_count: number;
  next_attempt_at: string | null;
  is_active: boolean;
  needs_relink?: boolean;
  reason_code?: string | null;
  last_refresh_ok_at?: string | null;
  last_client_seen_at?: string | null;
}

export interface ClassroomSyncResult {
  group_id: number;
  group_name: string;
  course_name?: string;
  synced_links: number;
  synced_tasks: number;
  synced_students: number;
  unmapped_tasks?: Array<{ title: string; due_date: string | null; reason: string }>;
}

export interface UserResource {
  id: number;
  username: string;
  email: string | null;
  name: string;
  role: "admin" | "editor" | "viewer" | string;
  is_active: boolean;
  allowed_groups: number[];
}

export interface BellSlotItem {
  lesson_number: number;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  break_after_minutes: number | null;
  is_optional: boolean;
}

export interface PublicBellsResponse {
  standard: BellSlotItem[];
  shortened: BellSlotItem[];
  today_date: string;
  is_shortened_today: boolean;
  today_reason: string | null;
  upcoming_shortened_days: ShortenedDayItem[];
}

export interface EducationalProcessWeekInfo {
  week_number: number;
  start_date: string;
  end_date: string;
}

export interface EducationalProcessCellInfo {
  week_number: number;
  period_type: string;
  name?: string | null;
}

export interface EducationalProcessGroupInfo {
  group_id: number;
  group_name: string;
  cells: EducationalProcessCellInfo[];
}

export interface EducationalProcessCourseInfo {
  course: number;
  groups: EducationalProcessGroupInfo[];
}

export interface EducationalProcessSemesterRange {
  semester_number: number;
  name: string;
  start_date: string;
  end_date: string;
  start_week: number;
  end_week: number;
}

export interface EducationalProcessMatrix {
  academic_year_start: number;
  weeks: EducationalProcessWeekInfo[];
  courses: EducationalProcessCourseInfo[];
  semesters?: EducationalProcessSemesterRange[];
}
