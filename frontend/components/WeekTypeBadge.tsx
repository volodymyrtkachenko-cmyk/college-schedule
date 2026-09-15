import { WeekType } from "../lib/api";

const labels: Record<WeekType, string> = {
  numerator: "Чисельник",
  denominator: "Знаменник",
  both: "Щотижня",
};

export function WeekTypeBadge({ weekType }: { weekType: WeekType }) {
  const styles: Record<WeekType, string> = {
    numerator: "bg-amber-400/10 text-amber-300 ring-amber-400/20",
    denominator: "bg-cyan-400/10 text-cyan-300 ring-cyan-400/20",
    both: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20",
  };
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${styles[weekType]}`}>
      {labels[weekType]}
    </span>
  );
}
