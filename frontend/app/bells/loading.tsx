export default function BellsLoading() {
  return (
    <div className="min-h-screen bg-sys-bg pb-24 lg:pb-12">
      <div className="h-14 sm:h-16 border-b border-sys-border bg-sys-card" />
      <main className="vt-main-content mx-auto max-w-4xl px-4 py-6 sm:px-6 space-y-6">
        <div className="h-24 rounded-2xl border border-sys-border bg-sys-card animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="h-72 rounded-2xl border border-sys-border bg-sys-card animate-pulse" />
          <div className="h-72 rounded-2xl border border-sys-border bg-sys-card animate-pulse" />
        </div>
      </main>
    </div>
  );
}
