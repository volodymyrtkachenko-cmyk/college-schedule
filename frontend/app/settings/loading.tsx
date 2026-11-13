export default function SettingsLoading() {
  return (
    <div className="min-h-screen bg-sys-bg pb-24 lg:pb-12">
      <div className="h-14 sm:h-16 border-b border-sys-border bg-sys-card" />
      <main className="vt-main-content mx-auto max-w-2xl px-4 py-6 sm:px-6 space-y-4">
        <div className="h-36 rounded-2xl border border-sys-border bg-sys-card animate-pulse" />
        <div className="h-44 rounded-2xl border border-sys-border bg-sys-card animate-pulse" />
        <div className="h-32 rounded-2xl border border-sys-border bg-sys-card animate-pulse" />
      </main>
    </div>
  );
}
