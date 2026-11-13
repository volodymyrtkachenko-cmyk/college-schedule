export default function EducationalProcessLoading() {
  return (
    <div className="min-h-screen bg-sys-bg pb-24 lg:pb-12">
      <div className="h-14 sm:h-16 border-b border-sys-border bg-sys-card" />
      <main className="vt-main-content mx-auto max-w-7xl px-4 py-6 sm:px-6 space-y-5">
        <div className="h-12 w-72 max-w-full rounded-xl border border-sys-border bg-sys-card animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="h-28 rounded-2xl border border-sys-border bg-sys-card animate-pulse" />
          <div className="h-28 rounded-2xl border border-sys-border bg-sys-card animate-pulse" />
          <div className="h-28 rounded-2xl border border-sys-border bg-sys-card animate-pulse" />
        </div>
        <div className="h-80 rounded-2xl border border-sys-border bg-sys-card animate-pulse" />
      </main>
    </div>
  );
}
