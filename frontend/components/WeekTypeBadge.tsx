import { WeekType } from "../lib/api";

const labels: Record<WeekType, string> = {
  numerator: "Чисельник",
  denominator: "Знаменник",
  both: "Щотижня",
};

export function WeekTypeBadge({ weekType }: { weekType: WeekType }) {
  const styles: Record<WeekType, string> = {
    numerator: "bg-amber-500/15 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 ring-amber-500/30 dark:ring-amber-400/30",
    denominator: "bg-purple-500/15 dark:bg-purple-500/15 text-purple-800 dark:text-purple-300 ring-purple-500/30 dark:ring-purple-400/30",
    both: "bg-emerald-500/15 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 ring-emerald-500/30 dark:ring-emerald-400/30",
  };
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${styles[weekType]}`}>
      {labels[weekType]}
    </span>
  );
}
