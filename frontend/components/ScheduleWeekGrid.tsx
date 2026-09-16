import { Lesson, ScheduleResponse } from "../lib/api";
import { ScheduleDay } from "./ScheduleDay";

export function ScheduleWeekGrid({ week, scheduleMode = "student", canEdit = false, onEdit, onCreate, onNoteSave, onNoteDelete }: {
  week: ScheduleResponse[]; scheduleMode?: "student"|"teacher"; canEdit?: boolean; onEdit?: (lesson: Lesson) => void; onCreate?: (date: string) => void;
  onNoteSave?: (lesson: Lesson, note: string, date: string) => Promise<void>;
  onNoteDelete?: (lesson: Lesson, date: string) => Promise<void>;
}) {
  return (
    <div className="w-full pb-4">
      <div className="grid min-w-0 gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 xl:gap-3">
        {week.map((day) => <ScheduleDay key={day.date} schedule={day} mode="week" scheduleMode={scheduleMode} canEdit={canEdit} onEdit={onEdit} onCreate={onCreate} onNoteSave={onNoteSave} onNoteDelete={onNoteDelete} />)}
      </div>
    </div>
  );
}
