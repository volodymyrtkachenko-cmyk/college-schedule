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

const TYPE_COLORS: Record<string, string> = {
    theory: "bg-white text-black dark:bg-slate-800 dark:text-white",
    session: "bg-red-400 text-white",
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

const TYPE_NAMES: Record<string, string> = {
    theory: "Теоретичне навчання",
    session: "Екзаменаційна сесія",
    holiday: "Канікули",
    diploma: "Дипломне проєктування",
    attestation: "Атестація",
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
    
    const getMonthsForWeeks = (weeks: WeekInfo[]) => {
        const months: { name: string; colSpan: number }[] = [];
        let currentMonth = '';
        
        weeks.forEach(w => {
            const d = new Date(w.start_date);
            d.setDate(d.getDate() + 3);
            const monthName = d.toLocaleString('uk-UA', { month: 'long' });
            
            if (currentMonth === monthName) {
                months[months.length - 1].colSpan++;
            } else {
                currentMonth = monthName;
                months.push({ name: monthName, colSpan: 1 });
            }
        });
        return months;
    };

    const { sem1Weeks, sem2Weeks } = useMemo(() => {
        if (!matrix) return { sem1Weeks: [], sem2Weeks: [] };
        const splitIndex = matrix.weeks.findIndex(w => {
            const d = new Date(w.start_date);
            d.setDate(d.getDate() + 3);
            return d.getMonth() === 1; // February
        });
        const idx = splitIndex > 0 ? splitIndex : 22;
        return {
            sem1Weeks: matrix.weeks.slice(0, idx),
            sem2Weeks: matrix.weeks.slice(idx)
        };
    }, [matrix]);

    const renderTable = (weeksToRender: WeekInfo[], title: string) => {
        if (!weeksToRender.length || !filteredCourses.length) return null;
        const months = getMonthsForWeeks(weeksToRender);
        return (
            <div className="hidden md:block mb-10">
                <h3 className="text-xl font-bold mb-4 text-slate-800 dark:text-slate-200">{title}</h3>
                <div className="overflow-x-auto border border-slate-300 dark:border-slate-700 rounded-xl shadow-sm bg-white dark:bg-slate-900 custom-scrollbar">
                    <table className="w-full text-center border-collapse text-xs">
                        <thead>
                            <tr>
                                <th rowSpan={2} className="border-b border-r border-slate-300 dark:border-slate-700 p-3 min-w-[60px] sticky left-0 bg-white dark:bg-slate-900 z-30 shadow-[1px_0_0_0_rgba(203,213,225,1)] dark:shadow-[1px_0_0_0_rgba(51,65,85,1)]">Курс</th>
                                <th rowSpan={2} className="border-b border-r border-slate-300 dark:border-slate-700 p-3 min-w-[120px] sticky left-[60px] bg-white dark:bg-slate-900 z-30 shadow-[1px_0_0_0_rgba(203,213,225,1)] dark:shadow-[1px_0_0_0_rgba(51,65,85,1)]">Група</th>
                                {months.map((m, i) => (
                                    <th key={i} colSpan={m.colSpan} className="border-b border-l border-slate-300 dark:border-slate-700 p-1 font-semibold text-xs sm:text-sm text-slate-700 dark:text-slate-300 capitalize text-center">
                                        {m.name}
                                    </th>
                                ))}
                            </tr>
                            <tr>
                                {weeksToRender.map((w, idx) => (
                                    <th key={w.week_number} className="border-b border-l border-slate-300 dark:border-slate-700 p-0 font-medium text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/50" title={`${w.start_date} - ${w.end_date}`}>
                                        <div style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }} className="py-2 mx-auto whitespace-nowrap min-h-[90px] flex items-center justify-center">
                                            {formatDate(w.start_date)} - {formatDate(w.end_date)}
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filteredCourses.map((course) => (
                                course.groups.map((group, gIdx) => (
                                    <tr key={group.group_id} className="group hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                                        {gIdx === 0 && (
                                            <td 
                                                rowSpan={course.groups.length} 
                                                className="border-t border-r border-slate-300 dark:border-slate-700 p-2 font-bold text-lg sticky left-0 bg-white dark:bg-slate-900 z-10 shadow-[1px_0_0_0_rgba(203,213,225,1)] dark:shadow-[1px_0_0_0_rgba(51,65,85,1)]"
                                            >
                                                {course.course}
                                            </td>
                                        )}
                                        <td className="border-t border-r border-slate-300 dark:border-slate-700 p-2.5 font-semibold text-slate-800 dark:text-slate-200 sticky left-[60px] bg-white dark:bg-slate-900 z-10 shadow-[1px_0_0_0_rgba(203,213,225,1)] dark:shadow-[1px_0_0_0_rgba(51,65,85,1)] whitespace-nowrap group-hover:bg-slate-50 dark:group-hover:bg-slate-800 transition-colors">
                                            {group.group_name}
                                        </td>
                                        {group.cells.filter(c => weeksToRender.some(wt => wt.week_number === c.week_number)).map(cell => (
                                            <td 
                                                key={cell.week_number} 
                                                className={`border-t border-slate-200 dark:border-slate-800 m-[1px] font-bold ${getCellStyles(cell)}`}
                                                title={cell.name || cell.period_type}
                                            >
                                                <div className="w-full h-full p-1.5 flex items-center justify-center">
                                                    {getCellLabel(cell)}
                                                </div>
                                            </td>
                                        ))}
                                    </tr>
                                ))
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    const renderMobileTimeline = () => {
        if (!matrix || !filteredCourses.length) return null;
        
        return (
            <div className="md:hidden flex flex-col gap-8 mb-8">
                {filteredCourses.map(course => (
                    <div key={course.course} className="flex flex-col gap-4">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold">
                                {course.course}
                            </div>
                            <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200">Курс</h3>
                        </div>
                        
                        <div className="flex flex-col gap-6">
                            {course.groups.map(group => {
                                const merged = mergeCells(group.cells, matrix.weeks);
                                return (
                                    <div key={group.group_id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
                                        <div className="bg-slate-100 dark:bg-slate-800 px-4 py-3 font-bold text-lg border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                                            <span>{group.group_name}</span>
                                        </div>
                                        <div className="flex flex-col">
                                            {merged.map((m, idx) => (
                                                <div key={idx} className="flex border-b last:border-b-0 border-slate-100 dark:border-slate-800">
                                                    <div className="w-24 shrink-0 p-3 flex flex-col justify-center items-center text-xs font-semibold text-slate-500 dark:text-slate-400 border-r border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
                                                        <span>{formatDate(m.start_date)}</span>
                                                        <span className="text-[10px] opacity-70 my-0.5">до</span>
                                                        <span>{formatDate(m.end_date)}</span>
                                                    </div>
                                                    <div className="flex-1 p-3 flex items-center gap-3">
                                                        <span className={`w-8 h-8 shrink-0 flex items-center justify-center font-bold rounded-lg shadow-sm text-sm ${getCellStyles(m)}`}>
                                                            {getCellLabel(m)}
                                                        </span>
                                                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
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
                <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                    <div>
                        <Link href="/" className="text-blue-600 dark:text-blue-400 hover:underline mb-2 inline-block font-medium">
                            &larr; Назад до розкладу
                        </Link>
                        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Графік освітнього процесу на {year}/{year+1} рік</h1>
                    </div>
                </header>
                
                <div className="mb-6 flex flex-col gap-2 relative bg-white dark:bg-slate-900 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800">
                    <label className="text-sm font-semibold">Фільтр груп (мульти-вибір):</label>
                    <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto p-2 border border-slate-300 dark:border-slate-700 rounded-md bg-slate-50 dark:bg-slate-950 custom-scrollbar">
                        {allGroups.map(g => (
                            <label key={g.id} className={`flex items-center gap-1.5 px-3 py-1.5 rounded shadow-sm text-sm cursor-pointer transition-colors border ${selectedGroups.includes(g.id) ? 'bg-blue-50 border-blue-200 dark:bg-blue-900/30 dark:border-blue-800' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
                                <input 
                                    type="checkbox" 
                                    className="rounded border-slate-300 w-4 h-4 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                    checked={selectedGroups.includes(g.id)}
                                    onChange={(e) => {
                                        if (e.target.checked) {
                                            setSelectedGroups(prev => [...prev, g.id]);
                                        } else {
                                            setSelectedGroups(prev => prev.filter(id => id !== g.id));
                                        }
                                    }}
                                />
                                {g.name}
                            </label>
                        ))}
                        {allGroups.length === 0 && !loading && <span className="text-slate-500 text-sm p-2">Немає груп для відображення</span>}
                    </div>
                    <div className="text-sm text-slate-500 mt-1 flex items-center justify-between">
                        <span>{selectedGroups.length === 0 ? "Показано всі групи" : `Обрано: ${selectedGroups.length} груп(и)`}</span>
                        {selectedGroups.length > 0 && (
                            <button onClick={() => setSelectedGroups([])} className="text-blue-600 dark:text-blue-400 hover:underline font-medium">Скинути вибір</button>
                        )}
                    </div>
                </div>

                <div className="flex gap-x-6 gap-y-3 mb-6 flex-wrap text-sm bg-white dark:bg-slate-900 p-5 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800">
                    <div className="w-full font-bold text-slate-700 dark:text-slate-300 mb-1 border-b border-slate-200 dark:border-slate-700 pb-2">Умовні позначення:</div>
                    
                    <div className="flex items-center gap-2">
                        <span className={`w-7 h-7 flex items-center justify-center font-bold rounded shadow-sm text-xs ${TYPE_COLORS['theory']}`}>Т</span>
                        <span>Теоретичне навчання</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`w-7 h-7 flex items-center justify-center font-bold rounded shadow-sm text-xs ${TYPE_COLORS['session']}`}>С</span>
                        <span>Екзаменаційна сесія</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`w-7 h-7 flex items-center justify-center font-bold rounded shadow-sm text-xs ${TYPE_COLORS['holiday']}`}>К</span>
                        <span>Канікули</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`w-7 h-7 flex items-center justify-center font-bold rounded shadow-sm text-xs ${TYPE_COLORS['diploma']}`}>Д</span>
                        <span>Дипломне проєктування</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`w-7 h-7 flex items-center justify-center font-bold rounded shadow-sm text-xs ${TYPE_COLORS['attestation']}`}>А</span>
                        <span>Атестація</span>
                    </div>
                    
                    <div className="w-full mt-1 mb-1"></div>
                    
                    <div className="flex items-center gap-2">
                        <span className={`w-7 h-7 flex items-center justify-center font-bold rounded shadow-sm text-xs ${getPracticeColor("електрорадіомонтажна")}`}>Пем</span>
                        <span>Електрорадіомонтажна практика</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`w-7 h-7 flex items-center justify-center font-bold rounded shadow-sm text-xs ${getPracticeColor("комп'ютерна")}`}>Пк</span>
                        <span>Комп'ютерна практика</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`w-7 h-7 flex items-center justify-center font-bold rounded shadow-sm text-xs ${getPracticeColor("професійна")}`}>Ппр</span>
                        <span>Професійна практика</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`w-7 h-7 flex items-center justify-center font-bold rounded shadow-sm text-xs ${getPracticeColor("технологічна")}`}>Пт</span>
                        <span>Технологічна практика</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`w-7 h-7 flex items-center justify-center font-bold rounded shadow-sm text-xs ${getPracticeColor("переддипломна")}`}>Ппд</span>
                        <span>Переддипломна практика</span>
                    </div>
                </div>

                {loading ? (
                    <div className="flex justify-center p-20">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                    </div>
                ) : !matrix || matrix.courses.length === 0 ? (
                    <div className="text-center p-16 bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800">
                        <p className="text-lg font-medium text-slate-500">Немає даних для поточного навчального року.</p>
                    </div>
                ) : (
                    <>
                        {renderMobileTimeline()}
                        {renderTable(sem1Weeks, "I Семестр")}
                        {renderTable(sem2Weeks, "II Семестр")}
                    </>
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
