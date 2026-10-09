import React, { useEffect, useState } from "react";
import { api } from "../../lib/api";

export interface Publication {
  id: number;
  version_id: number | null;
  actor_id: number | null;
  timestamp: string;
  scope_manifest: string;
  is_reverted: boolean;
}

export const PublicationHistory: React.FC = () => {
  const [publications, setPublications] = useState<Publication[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchPublications = async () => {
    try {
      setLoading(true);
      const res = await api.publications.list();
      setPublications(res);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPublications();
  }, []);

  const handleRevert = async (id: number) => {
    if (!window.confirm("Ви дійсно хочете скасувати цю публікацію? Це відновить розклад до стану ПЕРЕД публікацією.")) return;
    try {
      await api.publications.revert(id);
      alert("Публікацію успішно скасовано.");
      fetchPublications();
    } catch (e: any) {
      alert("Помилка: " + (e.response?.data?.detail || e.message));
    }
  };

  return (
    <div className="surface-panel p-6 mt-6 rounded-xl border border-sys-border">
      <h3 className="text-lg font-bold mb-4 text-sys-text-primary">Історія публікацій (Відкат розкладу)</h3>
      {loading ? (
        <p className="text-sys-text-secondary">Завантаження...</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-left text-sys-text-secondary">
            <thead className="text-xs uppercase bg-black/20 text-sys-text-muted">
              <tr>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Дата/Час</th>
                <th className="px-4 py-3">Версія Бази</th>
                <th className="px-4 py-3">Масштаб (Групи)</th>
                <th className="px-4 py-3">Статус</th>
                <th className="px-4 py-3">Дія</th>
              </tr>
            </thead>
            <tbody>
              {publications.map((p) => {
                const scope = JSON.parse(p.scope_manifest);
                return (
                  <tr key={p.id} className="border-b border-sys-border/50 hover:bg-white/5">
                    <td className="px-4 py-3 font-medium text-sys-text-primary">{p.id}</td>
                    <td className="px-4 py-3">{new Date(p.timestamp).toLocaleString("uk-UA")}</td>
                    <td className="px-4 py-3">{p.version_id || "Імпорт (без версії)"}</td>
                    <td className="px-4 py-3">
                      {scope.group_ids?.length ? `${scope.group_ids.length} груп` : "Всі"}
                    </td>
                    <td className="px-4 py-3">
                      {p.is_reverted ? (
                        <span className="text-red-400 font-medium">Скасовано</span>
                      ) : (
                        <span className="text-emerald-400 font-medium">Активна</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {!p.is_reverted && (
                        <button
                          onClick={() => handleRevert(p.id)}
                          className="bg-red-500/20 text-red-400 hover:bg-red-500/30 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                        >
                          Відкотити
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {publications.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-6 text-sys-text-muted">
                    Історія публікацій порожня
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
