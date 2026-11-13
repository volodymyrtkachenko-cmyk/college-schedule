export interface PersonalSubmission {
  state: string;
  grade?: number | null;
  maxPoints?: number | null;
}

/**
 * Extracts a stable Classroom task identifier (`courseId_courseWorkId`) or clean URL key.
 */
export function extractClassroomTaskKey(url?: string | null): string | null {
  if (!url) return null;
  const m = url.match(/\/c\/([^\/\?#]+)\/a\/([^\/\?#]+)/i);
  if (m) {
    return `${m[1]}_${m[2]}`;
  }
  return url.split("?")[0].split("#")[0].replace(/\/details\/?$/i, "").replace(/\/+$/, "");
}

/**
 * Determines whether a task belongs to the currently linked student when personal submissions exist.
 */
export function isOwnTask(
  isLinked: boolean,
  submissions: Record<string, PersonalSubmission>,
  url: string | null | undefined,
  _taskTeacher?: string | null,
  _personalTeachers?: string[],
  _taskTitle?: string | null,
  _explicitSubgroup?: number | null
): boolean {
  if (!isLinked) return true;

  const hasSubmissions = Object.keys(submissions).length > 0;
  if (hasSubmissions && url) {
    const key = extractClassroomTaskKey(url);
    const isMyTask = Boolean(submissions[url] || (key && submissions[key]));
    if (!isMyTask) {
      return false;
    }
  }

  return true;
}
