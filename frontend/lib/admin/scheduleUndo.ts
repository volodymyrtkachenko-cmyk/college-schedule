export const MAX_ADMIN_UNDO_STACK = 15;

export interface BatchMoveUndoItem {
  source_group_id: number;
  source_date: string;
  source_lesson_number: number;
  target_group_id: number;
  target_date: string;
  target_lesson_number: number;
}

export type AdminUndoAction =
  | {
      kind: "cancel";
      label: string;
      groupId: number;
      date: string;
      lessonNumber: number;
    }
  | {
      kind: "restore";
      label: string;
      groupId: number;
      date: string;
      lessonNumber: number;
    }
  | {
      kind: "move";
      label: string;
      sourceGroupId: number;
      sourceDate: string;
      sourceLessonNumber: number;
      targetGroupId: number;
      targetDate: string;
      targetLessonNumber: number;
    }
  | {
      kind: "move_event";
      label: string;
      eventId: number;
      prevDate: string;
      prevLessonNumber: number;
      prevStartTime: string;
    }
  | {
      kind: "swap";
      label: string;
      firstGroupId: number;
      firstDate: string;
      firstLessonNumber: number;
      secondGroupId: number;
      secondDate: string;
      secondLessonNumber: number;
    }
  | {
      kind: "remove_replacement";
      label: string;
      groupId: number;
      date: string;
      lessonNumber: number;
    }
  | {
      kind: "restore_replacement";
      label: string;
      groupId: number;
      date: string;
      lessonNumber: number;
      subjectId: number | null;
      teacherId: number | null;
      secondTeacherId: number | null;
      room: string | null;
    }
  | {
      kind: "batch_move";
      label: string;
      items: BatchMoveUndoItem[];
    }
  | {
      kind: "toggle_shortened_day";
      label: string;
      date: string;
    };

export function pushUndoAction(
  stack: readonly AdminUndoAction[],
  action: AdminUndoAction,
  limit = MAX_ADMIN_UNDO_STACK
): AdminUndoAction[] {
  const next = [...stack, action];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

export function popUndoAction(
  stack: readonly AdminUndoAction[]
): { action: AdminUndoAction | null; rest: AdminUndoAction[] } {
  if (stack.length === 0) return { action: null, rest: [] };
  return {
    action: stack[stack.length - 1],
    rest: stack.slice(0, stack.length - 1),
  };
}

export function reverseBatchMoveItems(
  items: readonly BatchMoveUndoItem[]
): BatchMoveUndoItem[] {
  return items.map((item) => ({
    source_group_id: item.target_group_id,
    source_date: item.target_date,
    source_lesson_number: item.target_lesson_number,
    target_group_id: item.source_group_id,
    target_date: item.source_date,
    target_lesson_number: item.source_lesson_number,
  }));
}

export function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as { tagName?: string; isContentEditable?: boolean };
  if (el.isContentEditable) return true;
  const tag = typeof el.tagName === "string" ? el.tagName.toUpperCase() : "";
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Matches Ctrl+Z / Cmd+Z regardless of active OS keyboard layout (Latin 'z' or KeyZ code e.g. Cyrillic 'я').
 */
export function isAdminUndoShortcut(event: {
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  code?: string;
  key?: string;
  target?: EventTarget | null;
}): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) {
    return false;
  }
  if (isEditableEventTarget(event.target ?? null)) {
    return false;
  }
  const code = (event.code || "").toLowerCase();
  const key = (event.key || "").toLowerCase();
  return code === "keyz" || key === "z";
}
