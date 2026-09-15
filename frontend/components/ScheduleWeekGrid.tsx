import { Lesson, ScheduleResponse } from "../lib/api";
import { ScheduleDay } from "./ScheduleDay";

export function ScheduleWeekGrid({ week, canEdit = false, onEdit, onCreate, onNoteSave, onNoteDelete }: {
  week: ScheduleResponse[]; canEdit?: boolean; onEdit?: (lesson: Lesson) => void; onCreate?: (date: string) => void;
  onNoteSave?: (lesson: Lesson, note: string, date: string) => Promise<void>;
  onNoteDelete?: (lesson: Lesson, date: string) => Promise<void>;
}) {
  return (
    <div className="grid min-w-0 gap-5 md:grid-cols-2 lg:grid-cols-7 lg:gap-3">
      {week.map((day) => <ScheduleDay key={day.date} schedule={day} canEdit={canEdit} onEdit={onEdit} onCreate={onCreate} onNoteSave={onNoteSave} onNoteDelete={onNoteDelete} />)}
    </div>
  );
}
