"use client";
import { useState, useEffect } from "react";
import { api, UserResource, ReferenceRecord } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";

export function UsersPanel() {
    const { user: currentUser } = useAuth();
    const [users, setUsers] = useState<UserResource[]>([]);
    const [groups, setGroups] = useState<ReferenceRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [editor, setEditor] = useState<Partial<UserResource> & { password?: string } | null>(null);

    async function load() {
        if (!currentUser) return;
        setLoading(true);
        try {
            const session = await api.auth.ensureAuthenticated();
            const [data, groupsData] = await Promise.all([
                 api.users.list(session.access_token),
                 api.references.list("groups", session.access_token)
            ]);
            setUsers(data);
            setGroups(groupsData);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
    }, [currentUser]);

    async function save(e: React.FormEvent) {
        e.preventDefault();
        try {
            const session = await api.auth.ensureAuthenticated();
            if (editor?.id) {
                await api.users.update(editor.id, editor, session.access_token);
            } else {
                await api.users.create(editor, session.access_token);
            }
            setEditor(null);
            load();
        } catch (err: any) {
            alert(err.message || "Помилка збереження");
        }
    }

    async function remove(id: number) {
        if (!confirm("Ви впевнені?")) return;
        try {
            const session = await api.auth.ensureAuthenticated();
            await api.users.remove(id, session.access_token);
            load();
        } catch (err: any) {
            alert(err.message || "Помилка");
        }
    }

    if (loading) return <div className="p-8 text-center text-sys-text-secondary">Завантаження...</div>;

    if (editor) {
        return (
            <form onSubmit={save} className="bg-sys-card p-6 rounded-xl border border-sys-border max-w-xl">
                <h3 className="text-xl font-bold mb-4">{editor.id ? "Редагувати користувача" : "Новий користувач"}</h3>
                <div className="space-y-4">
                    <label className="block">
                        <span className="block text-sm mb-1 text-sys-text-secondary">Ім'я (ПІБ або посада)</span>
                        <input required type="text" value={editor.name || ""} onChange={e => setEditor({...editor, name: e.target.value})} className="w-full bg-sys-input border border-sys-border rounded-lg px-3 py-2 text-sys-text-primary" />
                    </label>
                    <label className="block">
                        <span className="block text-sm mb-1 text-sys-text-secondary">Логін</span>
                        <input required type="text" disabled={!!editor.id} value={editor.username || ""} onChange={e => setEditor({...editor, username: e.target.value})} className="w-full bg-sys-input border border-sys-border rounded-lg px-3 py-2 text-sys-text-primary disabled:opacity-50" />
                    </label>
                    <label className="block">
                        <span className="block text-sm mb-1 text-sys-text-secondary">{editor.id ? "Новий пароль (залиште пустим, щоб не змінювати)" : "Пароль"}</span>
                        <input required={!editor.id} type="password" value={editor.password || ""} onChange={e => setEditor({...editor, password: e.target.value})} className="w-full bg-sys-input border border-sys-border rounded-lg px-3 py-2 text-sys-text-primary" />
                    </label>
                    <label className="block">
                        <span className="block text-sm mb-1 text-sys-text-secondary">Роль</span>
                        <select required disabled={editor.id === 1} value={editor.role || "editor"} onChange={e => setEditor({...editor, role: e.target.value as any})} className="w-full bg-sys-input border border-sys-border rounded-lg px-3 py-2 text-sys-text-primary disabled:opacity-50">
                            <option value="editor">Редактор розкладу (Куратор)</option>
                            <option value="admin">Головний адміністратор</option>
                        </select>
                    </label>
                    
                    {editor.role === "editor" && (
                        <div className="block">
                            <span className="block text-sm mb-2 text-sys-text-secondary">Дозволені групи для редагування</span>
                            <div className="flex flex-wrap gap-2 p-3 bg-sys-input/50 rounded-lg border border-sys-border/50 max-h-[300px] overflow-y-auto">
                                {groups.length === 0 && <div className="text-sm text-sys-text-secondary italic">Групи не знайдено...</div>}
                                {groups.map(g => {
                                    const checked = (editor.allowed_groups || []).includes(g.id);
                                    return (
                                        <button 
                                            key={g.id} 
                                            type="button"
                                            onClick={() => {
                                                const current = editor.allowed_groups || [];
                                                setEditor({
                                                    ...editor, 
                                                    allowed_groups: !checked ? [...current, g.id] : current.filter(id => id !== g.id)
                                                });
                                            }}
                                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${checked ? "bg-sys-accent/20 border-sys-accent text-sys-accent" : "bg-sys-bg border-sys-border text-sys-text-secondary hover:bg-white/5 hover:border-sys-text-muted"}`}
                                        >
                                            {checked ? (
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                            ) : (
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-50"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>
                                            )}
                                            {g.name}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
                <div className="mt-6 flex gap-3">
                    <button type="submit" className="bg-sys-accent text-slate-950 font-bold px-4 py-2 rounded-lg">Зберегти</button>
                    <button type="button" onClick={() => setEditor(null)} className="px-4 py-2 rounded-lg text-sys-text-secondary border border-sys-border hover:text-white">Скасувати</button>
                </div>
            </form>
        );
    }

    return (
        <div className="bg-sys-card p-6 rounded-xl border border-sys-border">
            <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold">Користувачі системи</h3>
                <button onClick={() => setEditor({ role: "editor", allowed_groups: [] })} className="bg-sys-accent text-slate-950 font-bold px-4 py-2 rounded-lg text-sm">+ Додати користувача</button>
            </div>
            
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="border-b border-sys-border text-sys-text-secondary text-sm">
                            <th className="py-3 px-4 font-medium min-w-[200px]">Ім'я / Логін</th>
                            <th className="py-3 px-4 font-medium min-w-[150px]">Роль</th>
                            <th className="py-3 px-4 font-medium">Доступ до груп</th>
                            <th className="py-3 px-4 font-medium text-right w-[100px]">Дії</th>
                        </tr>
                    </thead>
                    <tbody>
                        {users.map(u => (
                            <tr key={u.id} className="border-b border-sys-border/50 hover:bg-white/5 transition-colors">
                                <td className="py-3 px-4">
                                    <div className="font-medium">{u.name}</div>
                                    <div className="text-xs text-sys-text-secondary font-mono mt-0.5">@{u.username}</div>
                                </td>
                                <td className="py-3 px-4">
                                    <span className={`px-2.5 py-1 rounded-md text-xs font-semibold ${u.role === 'admin' ? 'bg-rose-500/10 text-rose-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                                        {u.role === 'admin' ? 'Адмін' : 'Редактор'}
                                    </span>
                                </td>
                                <td className="py-3 px-4 max-w-[300px]">
                                    {u.role === 'admin' ? (
                                        <span className="text-xs text-sys-text-secondary">Усі групи (повний доступ)</span>
                                    ) : (
                                        <div className="flex flex-wrap gap-1">
                                            {u.allowed_groups.length === 0 ? <span className="text-xs text-rose-400">Немає доступу</span> : null}
                                            {u.allowed_groups.slice(0, 5).map(gid => {
                                                const gName = groups.find(g => g.id === gid)?.name;
                                                return gName ? <span key={gid} className="bg-sys-bg border border-sys-border px-1.5 py-0.5 rounded text-xs text-sys-text-secondary truncate max-w-[80px]">{gName}</span> : null;
                                            })}
                                            {u.allowed_groups.length > 5 && (
                                                <span className="bg-sys-bg border border-sys-border px-1.5 py-0.5 rounded text-xs text-sys-text-secondary">+{u.allowed_groups.length - 5}</span>
                                            )}
                                        </div>
                                    )}
                                </td>
                                <td className="py-3 px-4 text-right space-x-2">
                                    <button onClick={() => setEditor(u)} className="text-sys-accent hover:underline text-sm p-1">Ред</button>
                                    <button onClick={() => remove(u.id)} disabled={u.id === currentUser?.id || u.id === 1} className="text-rose-400 hover:underline text-sm p-1 disabled:opacity-30 disabled:hover:no-underline">Вид</button>
                                </td>
                            </tr>
                        ))}
                        {users.length === 0 && (
                            <tr>
                                <td colSpan={4} className="py-8 text-center text-sys-text-secondary text-sm">Немає користувачів</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
