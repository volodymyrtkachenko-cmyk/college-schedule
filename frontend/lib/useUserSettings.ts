"use client";

import { useSyncExternalStore, useCallback } from "react";

export interface UserSettings {
  showHomeworkBadges: boolean;
  defaultSubgroup: 1 | 2 | "all" | null; // 1, 2, "all" (обидві), or null (авто)
  defaultViewDesktop: "week" | "today";
}

const HW_BADGES_KEY = "schedule:show_hw_badges";
const SUBGROUP_KEY = "schedule_selected_subgroup";
const VIEW_DESKTOP_KEY = "schedule:default_view_desktop";
const SETTINGS_CHANGE_EVENT = "schedule-settings-change";

const DEFAULT_SERVER_SETTINGS: UserSettings = {
  showHomeworkBadges: true,
  defaultSubgroup: null,
  defaultViewDesktop: "today",
};

let _cachedSettingsSnapshot: UserSettings | null = null;
const _settingsSubscribers = new Set<() => void>();

function readSettingsFromStorage(): UserSettings {
  if (typeof window === "undefined") {
    return DEFAULT_SERVER_SETTINGS;
  }

  let showHomeworkBadges = true;
  try {
    const val = localStorage.getItem(HW_BADGES_KEY);
    if (val !== null) showHomeworkBadges = val !== "false";
  } catch {}

  let defaultSubgroup: 1 | 2 | "all" | null = null;
  try {
    const val = localStorage.getItem(SUBGROUP_KEY);
    if (val === "1" || val === "2") {
      defaultSubgroup = parseInt(val, 10) as 1 | 2;
    } else if (val === "all") {
      defaultSubgroup = "all";
    } else if (val === "null" || val === "0") {
      defaultSubgroup = null;
    }
  } catch {}

  let defaultViewDesktop: "week" | "today" = "today";
  try {
    const val = localStorage.getItem(VIEW_DESKTOP_KEY);
    if (val === "week" || val === "today") defaultViewDesktop = val;
  } catch {}

  return {
    showHomeworkBadges,
    defaultSubgroup,
    defaultViewDesktop,
  };
}

function getSettingsSnapshot(): UserSettings {
  if (!_cachedSettingsSnapshot) {
    _cachedSettingsSnapshot = readSettingsFromStorage();
  }
  return _cachedSettingsSnapshot;
}

function notifySettingsChange() {
  _cachedSettingsSnapshot = readSettingsFromStorage();
  _settingsSubscribers.forEach((fn) => fn());
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e: StorageEvent) => {
    if (
      e.key === null ||
      e.key === HW_BADGES_KEY ||
      e.key === SUBGROUP_KEY ||
      e.key === VIEW_DESKTOP_KEY
    ) {
      notifySettingsChange();
    }
  });
}

function subscribeSettings(cb: () => void) {
  _settingsSubscribers.add(cb);
  return () => {
    _settingsSubscribers.delete(cb);
  };
}

export function getUserSettings(): UserSettings {
  return getSettingsSnapshot();
}

export function useUserSettings() {
  const settings = useSyncExternalStore(
    subscribeSettings,
    getSettingsSnapshot,
    () => DEFAULT_SERVER_SETTINGS
  );

  const updateSetting = useCallback(<K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    try {
      if (key === "showHomeworkBadges") {
        localStorage.setItem(HW_BADGES_KEY, String(value));
      } else if (key === "defaultSubgroup") {
        if (value === null) {
          localStorage.removeItem(SUBGROUP_KEY);
        } else {
          localStorage.setItem(SUBGROUP_KEY, String(value));
        }
      } else if (key === "defaultViewDesktop") {
        localStorage.setItem(VIEW_DESKTOP_KEY, String(value));
      }
      window.dispatchEvent(
        new CustomEvent(SETTINGS_CHANGE_EVENT, { detail: { key, value } })
      );
    } catch {}
    notifySettingsChange();
  }, []);

  return {
    settings,
    updateSetting,
    reload: notifySettingsChange,
  };
}
