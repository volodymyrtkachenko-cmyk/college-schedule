"use client";

import { useEffect, useState } from "react";
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
    theory: "bg-white text-black",
    session: "bg-yellow-300 text-black",
    practice: "bg-green-400 text-black",
    holiday: "bg-blue-400 text-white",
    diploma: "bg-purple-400 text-white",
    attestation: "bg-red-400 text-white",
};

const TYPE_LABELS: Record<string, string> = {
    theory: "Т",
    session: "С",
    practice: "П",
    holiday: "К",
    diploma: "Д",
    attestation: "А",
};

export default function EducationalProcessPage() {
    const router = useRouter();
    const [matrix, setMatrix] = useState<EducationalProcessMatrix | null>(null);
    const [loading, setLoading] = useState(true);
    const [year, setYear] = useState(2026);
    
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

    return (
        <div className="min-h-screen bg-sys-bg text-sys-text p-4 md:p-8 font-sans">
            <div className="max-w-7xl mx-auto">
                <header className="flex justify-between items-center mb-8">
                    <div>
                        <Link href="/" className="text-sys-accent hover:underline mb-2 inline-block">
                            &larr; Назад до розкладу
                        </Link>
                        <h1 className="text-2xl md:text-3xl font-bold">Графік освітнього процесу</h1>
                    </div>
                    
                    <div className="flex items-center gap-4">
                        <label className="text-sm font-medium">Навчальний рік:</label>
                        <select 
                            className="bg-sys-bg-secondary border border-sys-border rounded p-2 text-sys-text"
                            value={year}
                            onChange={e => setYear(Number(e.target.value))}
                        >
                            <option value={2025}>2025-2026</option>
                            <option value={2026}>2026-2027</option>
                            <option value={2027}>2027-2028</option>
                        </select>
                    </div>
                </header>

                <div className="flex gap-4 mb-6 flex-wrap text-sm bg-sys-bg-secondary p-4 rounded-lg border border-sys-border">
                    <div className="font-bold mr-2">Умовні позначення:</div>
                    {Object.entries(TYPE_LABELS).map(([key, label]) => (
                        <div key={key} className="flex items-center gap-2">
                            <span className={`w-6 h-6 flex items-center justify-center font-bold rounded ${TYPE_COLORS[key] || "bg-gray-500 text-white"}`}>
                                {label}
                            </span>
                            <span>
                                {key === 'theory' && 'Теоретичне навчання'}
                                {key === 'session' && 'Екзаменаційна сесія'}
                                {key === 'practice' && 'Практика'}
                                {key === 'holiday' && 'Канікули'}
                                {key === 'diploma' && 'Дипломне проєктування'}
                                {key === 'attestation' && 'Атестація'}
                            </span>
                        </div>
                    ))}
                </div>

                {loading ? (
                    <div className="flex justify-center p-12">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sys-accent"></div>
                    </div>
                ) : !matrix || matrix.courses.length === 0 ? (
                    <div className="text-center p-12 bg-sys-bg-secondary rounded-lg border border-sys-border">
                        <p>Немає даних для {year}/{year+1} навчального року.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto border border-sys-border rounded-lg bg-sys-bg-secondary">
                        <table className="w-full text-center border-collapse text-xs md:text-sm">
                            <thead>
                                <tr>
                                    <th className="border border-sys-border p-2 min-w-[60px] sticky left-0 bg-sys-bg-secondary z-10">Курс</th>
                                    <th className="border border-sys-border p-2 min-w-[120px] sticky left-[60px] bg-sys-bg-secondary z-10">Група</th>
                                    {matrix.weeks.map(w => (
                                        <th key={w.week_number} className="border border-sys-border p-1 min-w-[30px] font-normal text-xs" title={`${w.start_date} - ${w.end_date}`}>
                                            {w.week_number}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {matrix.courses.map((course) => (
                                    course.groups.map((group, gIdx) => (
                                        <tr key={group.group_id} className="hover:bg-sys-bg-hover transition-colors">
                                            {gIdx === 0 && (
                                                <td 
                                                    rowSpan={course.groups.length} 
                                                    className="border border-sys-border p-2 font-bold sticky left-0 bg-sys-bg-secondary z-10"
                                                >
                                                    {course.course}
                                                </td>
                                            )}
                                            <td className="border border-sys-border p-2 font-medium sticky left-[60px] bg-sys-bg-secondary z-10 whitespace-nowrap">
                                                {group.group_name}
                                            </td>
                                            {group.cells.map(cell => (
                                                <td 
                                                    key={cell.week_number} 
                                                    className={`border border-sys-border ${TYPE_COLORS[cell.period_type] || "bg-gray-500 text-white"}`}
                                                    title={cell.name || cell.period_type}
                                                >
                                                    {TYPE_LABELS[cell.period_type] || "?"}
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
        </div>
    );
}
