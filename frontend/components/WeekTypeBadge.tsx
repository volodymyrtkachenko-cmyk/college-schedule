import { WeekType } from "../lib/api";

const labels: Record<WeekType, string> = {
  numerator: "Чисельник",
  denominator: "Знаменник",
  both: "Щотижня",
};

export function WeekTypeBadge({ weekType }: { weekType: WeekType }) {
  const styles: Record<WeekType, string> = {
    numerator: "bg-sys-surface text-sys-text-secondary ring-sys-border",
    denominator: "bg-sys-surface text-sys-text-secondary ring-sys-border",
    both: "bg-sys-surface text-sys-text-muted ring-sys-border",
  };
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${styles[weekType]}`}>
      {labels[weekType]}
    </span>
  );
}
