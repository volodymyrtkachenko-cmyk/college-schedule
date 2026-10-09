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
    <div className="bg-white p-4 rounded shadow-md mt-4">
      <h3 className="text-lg font-bold mb-4">Історія публікацій (Відкат розкладу)</h3>
      {loading ? (
        <p>Завантаження...</p>
      ) : (
        <table className="min-w-full text-sm text-left">
          <thead className="text-xs text-gray-700 uppercase bg-gray-100">
            <tr>
              <th className="px-4 py-2">ID</th>
              <th className="px-4 py-2">Дата/Час</th>
              <th className="px-4 py-2">Версія Бази</th>
              <th className="px-4 py-2">Масштаб (Групи)</th>
              <th className="px-4 py-2">Статус</th>
              <th className="px-4 py-2">Дія</th>
            </tr>
          </thead>
          <tbody>
            {publications.map((p) => {
              const scope = JSON.parse(p.scope_manifest);
              return (
                <tr key={p.id} className="border-b">
                  <td className="px-4 py-2">{p.id}</td>
                  <td className="px-4 py-2">{new Date(p.timestamp).toLocaleString("uk-UA")}</td>
                  <td className="px-4 py-2">{p.version_id || "Імпорт (без версії)"}</td>
                  <td className="px-4 py-2">
                    {scope.group_ids?.length ? `${scope.group_ids.length} груп` : "Всі"}
                  </td>
                  <td className="px-4 py-2">
                    {p.is_reverted ? (
                      <span className="text-red-600 font-bold">Скасовано</span>
                    ) : (
                      <span className="text-green-600">Активна</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {!p.is_reverted && (
                      <button
                        onClick={() => handleRevert(p.id)}
                        className="bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded text-xs"
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
                <td colSpan={6} className="text-center py-4 text-gray-500">
                  Історія публікацій порожня
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
};
