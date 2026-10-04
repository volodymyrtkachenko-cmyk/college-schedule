"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface CellInfo {
    week_number: number;
    period_type: string;
    name: string | null;
}

interface GroupProcessInfo {
    group_id: number;
    group_name: string;
    cells: CellInfo[];
}

interface CourseProcessInfo {
    course: number;
    groups: GroupProcessInfo[];
}

interface WeekInfo {
    week_number: number;
    start_date: string;
    end_date: string;
}

interface EducationalProcessMatrix {
    academic_year_start: number;
    weeks: WeekInfo[];
    courses: CourseProcessInfo[];
}

const TYPE_NAMES: Record<string, string> = {
    theory: "Теоретичне навчання",
    session: "Екзаменаційна сесія",
    holiday: "Канікули",
    diploma: "Дипломне проєктування",
    attestation: "Атестація",
};

const TYPE_COLORS: Record<string, string> = {
    theory: "bg-white text-black dark:bg-slate-800 dark:text-white border border-slate-200 dark:border-slate-700",
    session: "bg-red-500 text-white",
    holiday: "bg-green-500 text-white",
    diploma: "bg-purple-500 text-white",
    attestation: "bg-blue-600 text-white",
};

const TYPE_LABELS: Record<string, string> = {
    theory: "Т",
    session: "С",
    holiday: "К",
    diploma: "Д",
    attestation: "А",
};

function getPracticeAbbr(name: string | null) {
    if (!name) return "П";
    const n = name.toLowerCase();
    if (n.includes("електрорадіомонтажна")) return "Пем";
    if (n.includes("комп'ютерна")) return "Пк";
    if (n.includes("професійна")) return "Ппр";
    if (n.includes("технологічна")) return "Пт";
    if (n.includes("переддипломна")) return "Ппд";
    return "П";
}

function getPracticeColor(name: string | null) {
    if (!name) return "bg-orange-300 text-black";
    const n = name.toLowerCase();
    if (n.includes("електрорадіомонтажна")) return "bg-yellow-400 text-black";
    if (n.includes("комп'ютерна")) return "bg-orange-400 text-black";
    if (n.includes("професійна")) return "bg-orange-500 text-white";
    if (n.includes("технологічна")) return "bg-amber-500 text-white";
    if (n.includes("переддипломна")) return "bg-amber-600 text-white";
    return "bg-orange-300 text-black";
}

function getCellStyles(cell: {period_type: string, name: string | null}) {
    if (cell.period_type === "practice") {
        return getPracticeColor(cell.name);
    }
    return TYPE_COLORS[cell.period_type] || "bg-gray-500 text-white";
}

function getCellLabel(cell: {period_type: string, name: string | null}) {
    if (cell.period_type === "practice") {
        return getPracticeAbbr(cell.name);
    }
    return TYPE_LABELS[cell.period_type] || "?";
}

function formatDate(dateStr: string) {
    const d = new Date(dateStr);
    return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}`;
}

interface MergedPeriod {
    start_date: string;
    end_date: string;
    period_type: string;
    name: string | null;
}

function mergeCells(cells: CellInfo[], weeks: WeekInfo[]): MergedPeriod[] {
    if (!cells.length || !weeks.length) return [];
    
    const sortedCells = [...cells].sort((a, b) => a.week_number - b.week_number);
    const merged: MergedPeriod[] = [];
    let currentPeriod: MergedPeriod | null = null;
    
    for (const cell of sortedCells) {
        const week = weeks.find(w => w.week_number === cell.week_number);
        if (!week) continue;
        
        if (!currentPeriod) {
            currentPeriod = {
                start_date: week.start_date,
                end_date: week.end_date,
                period_type: cell.period_type,
                name: cell.name
            };
        } else if (currentPeriod.period_type === cell.period_type && currentPeriod.name === cell.name) {
            currentPeriod.end_date = week.end_date;
        } else {
            merged.push(currentPeriod);
            currentPeriod = {
                start_date: week.start_date,
                end_date: week.end_date,
                period_type: cell.period_type,
                name: cell.name
            };
        }
    }
    if (currentPeriod) {
        merged.push(currentPeriod);
    }
    
    return merged;
}

export default function EducationalProcessPage() {
    const router = useRouter();
    const [matrix, setMatrix] = useState<EducationalProcessMatrix | null>(null);
    const [loading, setLoading] = useState(true);
    const [selectedGroups, setSelectedGroups] = useState<number[]>([]);
    
    const year = useMemo(() => {
        const now = new Date();
        return now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
    }, []);
    
    useEffect(() => {
        setLoading(true);
        fetch(`${process.env.NEXT_PUBLIC_API_URL || ""}/api/educational-process?academic_year_start=${year}`)
            .then(r => r.json())
            .then(data => {
                setMatrix(data);
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setLoading(false);
            });
    }, [year]);

    const allGroups = useMemo(() => {
        if (!matrix) return [];
        return matrix.courses.flatMap(c => 
            c.groups.map(g => ({
                id: g.group_id,
                name: g.group_name,
                course: c.course
            }))
        ).sort((a, b) => a.name.localeCompare(b.name));
    }, [matrix]);

    const filteredCourses = useMemo(() => {
        if (!matrix) return [];
        if (selectedGroups.length === 0) return matrix.courses;
        return matrix.courses.map(c => ({
            course: c.course,
            groups: c.groups.filter(g => selectedGroups.includes(g.group_id))
        })).filter(c => c.groups.length > 0);
    }, [matrix, selectedGroups]);

    const renderTimeline = () => {
        if (!matrix || !filteredCourses.length) return null;
        
        return (
            <div className="flex flex-col gap-10 mb-8 max-w-3xl mx-auto w-full">
                {filteredCourses.map(course => (
                    <div key={course.course} className="flex flex-col gap-5">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-lg shadow-sm">
                                {course.course}
                            </div>
                            <h3 className="text-2xl font-bold text-slate-800 dark:text-slate-200">Курс</h3>
                        </div>
                        
                        <div className="flex flex-col gap-6">
                            {course.groups.map(group => {
                                const merged = mergeCells(group.cells, matrix.weeks);
                                return (
                                    <div key={group.group_id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
                                        <div className="bg-slate-100 dark:bg-slate-800 px-5 py-4 font-bold text-xl border-b border-slate-200 dark:border-slate-700 text-center">
                                            {group.group_name}
                                        </div>
                                        <div className="flex flex-col">
                                            {merged.map((m, idx) => (
                                                <div key={idx} className="flex border-b last:border-b-0 border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                                    <div className="w-28 shrink-0 py-4 px-3 flex flex-col justify-center items-center text-sm font-semibold text-slate-500 dark:text-slate-400 border-r border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
                                                        <span>{formatDate(m.start_date)}</span>
                                                        <span className="text-[11px] opacity-70 my-1 font-medium">до</span>
                                                        <span>{formatDate(m.end_date)}</span>
                                                    </div>
                                                    <div className="flex-1 py-4 px-5 flex items-center gap-4">
                                                        <span className={`w-10 h-10 shrink-0 flex items-center justify-center font-bold rounded-lg shadow-sm text-base ${getCellStyles(m)}`}>
                                                            {getCellLabel(m)}
                                                        </span>
                                                        <span className="text-base font-medium text-slate-700 dark:text-slate-300">
                                                            {m.period_type === "practice" ? m.name : (TYPE_NAMES[m.period_type] || m.period_type)}
                                                        </span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-4 md:p-8 font-sans">
            <div className="max-w-[1400px] mx-auto">
                <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 max-w-3xl mx-auto w-full">
                    <div>
                        <Link href="/" className="text-blue-600 dark:text-blue-400 hover:underline mb-2 inline-block font-medium">
                            &larr; Назад до розкладу
                        </Link>
                        <h1 className="text-3xl font-bold tracking-tight">Графік освітнього процесу на {year}/{year+1} рік</h1>
                    </div>
                </header>
                
                <div className="mb-10 max-w-3xl mx-auto w-full">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200">Групи</h2>
                        {selectedGroups.length > 0 && (
                            <button 
                                onClick={() => setSelectedGroups([])} 
                                className="text-sm font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
                            >
                                Скинути
                            </button>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-2.5 max-h-60 overflow-y-auto custom-scrollbar pr-2">
                        {allGroups.map(g => {
                            const isSelected = selectedGroups.includes(g.id);
                            return (
                                <button
                                    key={g.id}
                                    onClick={() => {
                                        if (isSelected) {
                                            setSelectedGroups(prev => prev.filter(id => id !== g.id));
                                        } else {
                                            setSelectedGroups(prev => [...prev, g.id]);
                                        }
                                    }}
                                    className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                                        isSelected 
                                            ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900 shadow-md' 
                                            : 'bg-slate-200/70 text-slate-600 hover:bg-slate-300/80 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'
                                    }`}
                                >
                                    {g.name}
                                </button>
                            );
                        })}
                        {allGroups.length === 0 && !loading && <span className="text-slate-500 text-sm">Немає груп для відображення</span>}
                    </div>
                </div>

                {loading ? (
                    <div className="flex justify-center p-20">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                    </div>
                ) : !matrix || matrix.courses.length === 0 ? (
                    <div className="text-center p-16 bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 max-w-3xl mx-auto w-full">
                        <p className="text-lg font-medium text-slate-500">Немає даних для поточного навчального року.</p>
                    </div>
                ) : (
                    renderTimeline()
                )}
            </div>
            <style jsx global>{`
                .custom-scrollbar::-webkit-scrollbar {
                    height: 12px;
                    width: 8px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background-color: #cbd5e1;
                    border-radius: 20px;
                    border: 3px solid transparent;
                    background-clip: content-box;
                }
                .dark .custom-scrollbar::-webkit-scrollbar-thumb {
                    background-color: #475569;
                }
            `}</style>
        </div>
    );
}
