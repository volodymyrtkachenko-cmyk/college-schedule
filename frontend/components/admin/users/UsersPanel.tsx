"use client";
import { useState, useEffect } from "react";
import { api, UserResource, ReferenceRecord } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { SearchableMultiSelect } from "../../SearchableMultiSelect";

export function UsersPanel() {
    const { user: currentUser } = useAuth();
    const [users, setUsers] = useState<UserResource[]>([]);
    const [groups, setGroups] = useState<ReferenceRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [editor, setEditor] = useState<Partial<UserResource> & { password?: string } | null>(null);
    const [searchTerm, setSearchTerm] = useState("");

    async function load() {
        if (!currentUser) return;
        setLoading(true);
        try {
            const session = await api.auth.ensureAuthenticated();
            
            try {
                const data = await api.users.list(session.access_token);
                setUsers(data);
            } catch (err: any) {
                console.error("Failed to load users:", err);
                alert("Не вдалося завантажити користувачів: " + err.message);
            }
            
            try {
                const groupsData = await api.groups();
                setGroups(groupsData);
            } catch (err: any) {
                console.error("Failed to load groups:", err);
                alert("Не вдалося завантажити список груп: " + err.message);
            }
            
        } catch (e: any) {
            console.error("Auth error:", e);
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
            alert("Не вдалося зберегти користувача: " + (err.message || "спробуйте ще раз."));
        }
    }

    async function remove(id: number) {
        const selectedUser = users.find((user) => user.id === id);
        if (!confirm(`Видалити користувача «${selectedUser?.name ?? ""}»?`)) return;
        try {
            const session = await api.auth.ensureAuthenticated();
            await api.users.remove(id, session.access_token);
            load();
        } catch (err: any) {
            alert("Не вдалося видалити користувача: " + (err.message || "спробуйте ще раз."));
        }
    }

    if (loading) return <div className="p-8 text-center text-sys-text-secondary">Завантаження…</div>;

    if (editor) {
        return (
            <form onSubmit={save} className="surface-panel max-w-2xl space-y-5 p-5 sm:p-7">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sys-accent">Доступ</p>
                    <h3 className="mt-1 text-xl font-bold">{editor.id ? "Редагування користувача" : "Новий користувач"}</h3>
                </div>
                <div className="space-y-4">
                    <label className="block">
                        <span className="block text-sm mb-1 text-sys-text-secondary">Ім’я та прізвище або посада</span>
                        <input required type="text" value={editor.name || ""} onChange={e => setEditor({...editor, name: e.target.value})} className="form-control w-full" />
                    </label>
                    <label className="block">
                        <span className="block text-sm mb-1 text-sys-text-secondary">Ім’я користувача</span>
                        <input required type="text" disabled={!!editor.id} value={editor.username || ""} onChange={e => setEditor({...editor, username: e.target.value})} className="form-control w-full" />
                    </label>
                    <label className="block">
                        <span className="block text-sm mb-1 text-sys-text-secondary">
                            {editor.role === "admin" 
                                ? "Новий пароль (залиште порожнім, щоб не змінювати)"
                                : editor.id ? "Новий пароль (залиште порожнім, щоб не змінювати)" : "Пароль"}
                        </span>
                        <input required={!editor.id} type="password" placeholder={editor.id ? "••••••••••" : ""} value={editor.password || ""} onChange={e => setEditor({...editor, password: e.target.value})} className="form-control w-full" />
                    </label>
                    <label className="block">
                        <span className="block text-sm mb-1 text-sys-text-secondary">Роль</span>
                        <select required disabled={editor.id === 1} value={editor.role || "editor"} onChange={e => setEditor({...editor, role: e.target.value as any})} className="form-control w-full">
                            <option value="editor">Редактор розкладу</option>
                            <option value="admin">Адміністратор</option>
                        </select>
                    </label>
                    
                    {editor.role === "editor" && (
                        <div className="block">
                            <span className="mb-2 block text-sm text-sys-text-secondary">Дозволені групи для редагування</span>
                            <SearchableMultiSelect
                                options={[...groups].sort((a, b) => a.name.localeCompare(b.name, "uk"))}
                                value={editor.allowed_groups || []}
                                onChange={(allowed_groups) => setEditor({ ...editor, allowed_groups })}
                                placeholder="Знайти групу"
                            />
                        </div>
                    )}
                </div>
                <div className="mt-6 flex gap-3">
                    <button type="submit" className="rounded-lg bg-sys-accent px-4 py-2.5 font-bold text-slate-950 transition-opacity hover:opacity-90">Зберегти</button>
                    <button type="button" onClick={() => setEditor(null)} className="rounded-lg border border-sys-border px-4 py-2.5 text-sys-text-secondary transition-colors hover:bg-white/5 hover:text-white">Скасувати</button>
                </div>
            </form>
        );
    }

    const filteredUsers = users
        .filter(u => {
            if (!searchTerm) return true;
            const term = searchTerm.toLowerCase();
            return (u.name || "").toLowerCase().includes(term) || (u.username || "").toLowerCase().includes(term);
        })
        .sort((a, b) => {
            if (a.role === "admin" && b.role !== "admin") return -1;
            if (a.role !== "admin" && b.role === "admin") return 1;
            return (a.name || "").localeCompare(b.name || "", "uk");
        });

    return (
        <div className="surface-panel p-5 sm:p-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
                <h3 className="text-xl font-bold">Користувачі системи</h3>
                <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
                    <input 
                        type="search"
                        aria-label="Пошук користувачів"
                        placeholder="Знайти за ім’ям або ім’ям користувача"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="form-control w-full sm:w-[250px]"
                    />
                    <button onClick={() => setEditor({ role: "editor", allowed_groups: [] })} className="w-full sm:w-auto shrink-0 bg-sys-accent text-slate-950 font-bold px-4 py-2 rounded-lg text-sm whitespace-nowrap">+ Додати користувача</button>
                </div>
            </div>
            
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="border-b border-sys-border text-sys-text-secondary text-sm">
                            <th className="py-3 px-4 font-medium min-w-[200px]">Користувач</th>
                            <th className="py-3 px-4 font-medium min-w-[150px]">Роль</th>
                            <th className="py-3 px-4 font-medium">Доступ до груп</th>
                            <th className="py-3 px-4 font-medium text-right w-[100px]">Дії</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredUsers.map(u => (
                            <tr key={u.id} className="border-b border-sys-border/50 hover:bg-white/5 transition-colors">
                                <td className="py-3 px-4">
                                    <div className="font-medium">{u.name}</div>
                                    <div className="text-xs text-sys-text-secondary font-mono mt-0.5">@{u.username}</div>
                                </td>
                                <td className="py-3 px-4">
                                    <span className={`px-2.5 py-1 rounded-md text-xs font-semibold ${u.role === 'admin' ? 'bg-rose-500/10 text-rose-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                                        {u.role === 'admin' ? 'Адміністратор' : 'Редактор'}
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
                                    <button onClick={() => setEditor(u)} className="text-sys-accent hover:underline text-sm p-1">Редагувати</button>
                                    <button onClick={() => remove(u.id)} disabled={u.id === currentUser?.id || u.id === 1} className="text-rose-400 hover:underline text-sm p-1 disabled:opacity-30 disabled:hover:no-underline">Видалити</button>
                                </td>
                            </tr>
                        ))}
                        {filteredUsers.length === 0 && (
                            <tr>
                                <td colSpan={4} className="py-8 text-center text-sys-text-secondary text-sm">Користувачів не знайдено.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
