export default function StatisticsLoading() {
  return (
    <div className="min-h-screen bg-sys-bg pb-24 lg:pb-12">
      <div className="h-14 sm:h-16 border-b border-sys-border bg-sys-card" />
      <main className="vt-main-content mx-auto max-w-5xl px-4 py-6 sm:px-6 space-y-5">
        <div className="flex flex-wrap gap-2">
          <div className="h-10 w-44 rounded-xl border border-sys-border bg-sys-card animate-pulse" />
          <div className="h-10 w-56 rounded-xl border border-sys-border bg-sys-card animate-pulse" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="h-32 rounded-2xl border border-sys-border bg-sys-card animate-pulse" />
          <div className="h-32 rounded-2xl border border-sys-border bg-sys-card animate-pulse" />
          <div className="h-32 rounded-2xl border border-sys-border bg-sys-card animate-pulse" />
        </div>
        <div className="h-72 rounded-2xl border border-sys-border bg-sys-card animate-pulse" />
      </main>
    </div>
  );
}
