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

function getCellStyles(cell: CellInfo) {
    if (cell.period_type === "practice") {
        return getPracticeColor(cell.name);
    }
    return TYPE_COLORS[cell.period_type] || "bg-gray-500 text-white";
}

function getCellLabel(cell: CellInfo) {
    if (cell.period_type === "practice") {
        return getPracticeAbbr(cell.name);
    }
    return TYPE_LABELS[cell.period_type] || "?";
}

export default function EducationalProcessPage() {
    const router = useRouter();
    const [matrix, setMatrix] = useState<EducationalProcessMatrix | null>(null);
    const [loading, setLoading] = useState(true);
    const [year, setYear] = useState(2026);
    const [selectedCourse, setSelectedCourse] = useState<number | "all">("all");
    
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

    const filteredCourses = useMemo(() => {
        if (!matrix) return [];
        if (selectedCourse === "all") return matrix.courses;
        return matrix.courses.filter(c => c.course === selectedCourse);
    }, [matrix, selectedCourse]);

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-4 md:p-8 font-sans">
            <div className="max-w-[1400px] mx-auto">
                <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                    <div>
                        <Link href="/" className="text-blue-600 dark:text-blue-400 hover:underline mb-2 inline-block font-medium">
                            &larr; Назад до розкладу
                        </Link>
                        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Графік освітнього процесу</h1>
                    </div>
                    
                    <div className="flex flex-wrap items-center gap-4 bg-white dark:bg-slate-900 p-3 rounded-lg shadow-sm border border-slate-200 dark:border-slate-800">
                        <div className="flex items-center gap-2">
                            <label className="text-sm font-semibold">Навчальний рік:</label>
                            <select 
                                className="bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md p-1.5 text-sm font-medium"
                                value={year}
                                onChange={e => setYear(Number(e.target.value))}
                            >
                                <option value={2025}>2025-2026</option>
                                <option value={2026}>2026-2027</option>
                                <option value={2027}>2027-2028</option>
                            </select>
                        </div>
                        <div className="flex items-center gap-2">
                            <label className="text-sm font-semibold">Курс:</label>
                            <select 
                                className="bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md p-1.5 text-sm font-medium"
                                value={selectedCourse}
                                onChange={e => setSelectedCourse(e.target.value === "all" ? "all" : Number(e.target.value))}
                            >
                                <option value="all">Усі курси</option>
                                {matrix?.courses.map(c => (
                                    <option key={c.course} value={c.course}>{c.course} курс</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </header>

                <div className="flex gap-x-6 gap-y-3 mb-6 flex-wrap text-sm bg-white dark:bg-slate-900 p-5 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800">
                    <div className="w-full font-bold text-slate-700 dark:text-slate-300 mb-1 border-b border-slate-200 dark:border-slate-700 pb-2">Умовні позначення:</div>
                    
                    {/* Basic types */}
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
                    
                    {/* Practices */}
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
                        <p className="text-lg font-medium text-slate-500">Немає даних для {year}/{year+1} навчального року.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto border border-slate-300 dark:border-slate-700 rounded-xl shadow-sm bg-white dark:bg-slate-900 custom-scrollbar">
                        <table className="w-full text-center border-collapse text-xs">
                            <thead>
                                <tr>
                                    <th className="border-b border-r border-slate-300 dark:border-slate-700 p-3 min-w-[60px] sticky left-0 bg-white dark:bg-slate-900 z-20 shadow-[1px_0_0_0_rgba(203,213,225,1)] dark:shadow-[1px_0_0_0_rgba(51,65,85,1)]">Курс</th>
                                    <th className="border-b border-r border-slate-300 dark:border-slate-700 p-3 min-w-[120px] sticky left-[60px] bg-white dark:bg-slate-900 z-20 shadow-[1px_0_0_0_rgba(203,213,225,1)] dark:shadow-[1px_0_0_0_rgba(51,65,85,1)]">Група</th>
                                    {matrix.weeks.map(w => (
                                        <th key={w.week_number} className="border-b border-slate-300 dark:border-slate-700 p-1 min-w-[34px] font-medium text-[10px] sm:text-xs text-slate-500 dark:text-slate-400" title={`${w.start_date} - ${w.end_date}`}>
                                            {w.week_number}
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
                                            {group.cells.map(cell => (
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
                )}
            </div>
            <style jsx global>{`
                .custom-scrollbar::-webkit-scrollbar {
                    height: 12px;
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
