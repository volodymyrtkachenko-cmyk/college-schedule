import { getSyncedNow } from "../date";

export type KyivNowSnapshot = { dateIso: string; minutes: number };

const UKR_DAY_NAMES: Record<number, string> = {
  1: "Понеділок",
  2: "Вівторок",
  3: "Середа",
  4: "Четвер",
  5: "П'ятниця",
  6: "Субота",
  7: "Неділя",
};

const KYIV_DATE_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" });
const KYIV_TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Kyiv",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function parseMinutes(timeStr?: string): number | null {
  if (!timeStr) return null;
  const [h, m] = timeStr.trim().split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

export function getKyivNow(): KyivNowSnapshot {
  const now = getSyncedNow();
  return {
    dateIso: KYIV_DATE_FMT.format(now),
    minutes: parseMinutes(KYIV_TIME_FMT.format(now)) ?? 0,
  };
}

let _sharedKyivNow: KyivNowSnapshot | null = null;
let _sharedKyivTimer: ReturnType<typeof setInterval> | null = null;
let _sharedKyivVisibilityHandler: (() => void) | null = null;
const _kyivNowSubscribers = new Set<(now: KyivNowSnapshot) => void>();

export function getSharedKyivNowSnapshot(): KyivNowSnapshot | null {
  return _sharedKyivNow;
}

export function ensureSharedKyivNowSnapshot(): KyivNowSnapshot {
  if (!_sharedKyivNow) {
    _sharedKyivNow = getKyivNow();
  }
  return _sharedKyivNow;
}

function notifyKyivNowIfChanged() {
  const next = getKyivNow();
  if (
    !_sharedKyivNow ||
    _sharedKyivNow.minutes !== next.minutes ||
    _sharedKyivNow.dateIso !== next.dateIso
  ) {
    _sharedKyivNow = next;
    _kyivNowSubscribers.forEach((sub) => sub(next));
  }
}

export function subscribeKyivNow(cb: (now: KyivNowSnapshot) => void) {
  _kyivNowSubscribers.add(cb);
  if (_kyivNowSubscribers.size === 1 && typeof window !== "undefined") {
    _sharedKyivNow = getKyivNow();
    _sharedKyivTimer = setInterval(() => {
      // Не будимо React у фоні: PWA згорнута — тиків немає (економія батареї)
      if (document.visibilityState === "hidden") return;
      notifyKyivNowIfChanged();
    }, 30_000);

    _sharedKyivVisibilityHandler = () => {
      if (document.visibilityState === "visible") {
        notifyKyivNowIfChanged();
      }
    };
    document.addEventListener("visibilitychange", _sharedKyivVisibilityHandler);
  }
  return () => {
    _kyivNowSubscribers.delete(cb);
    if (_kyivNowSubscribers.size === 0) {
      if (_sharedKyivTimer) {
        clearInterval(_sharedKyivTimer);
        _sharedKyivTimer = null;
      }
      if (_sharedKyivVisibilityHandler) {
        document.removeEventListener("visibilitychange", _sharedKyivVisibilityHandler);
        _sharedKyivVisibilityHandler = null;
      }
    }
  };
}

export function formatMovedTo(movedToDate?: string | null, movedToLesson?: number | null): string | null {
  if (!movedToDate) return null;
  const parts = movedToDate.split("-").map(Number);
  if (parts.length === 3) {
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    const dow = d.getDay() === 0 ? 7 : d.getDay();
    const dayName = UKR_DAY_NAMES[dow] || "";
    return `Перенесено → ${dayName}, ${movedToLesson || "?"} пара`;
  }
  return `Перенесено → ${movedToDate}`;
}

export function vibrateTap(ms = 10) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(ms);
    } catch {}
  }
}
