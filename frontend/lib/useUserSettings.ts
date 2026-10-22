"use client";

import { useState, useEffect, useCallback } from "react";

export interface UserSettings {
  showHomeworkBadges: boolean;
  defaultSubgroup: number | null; // 1, 2, or null (обидві/авто)
  defaultViewDesktop: "week" | "today";
}

const HW_BADGES_KEY = "schedule:show_hw_badges";
const SUBGROUP_KEY = "schedule_selected_subgroup";
const VIEW_DESKTOP_KEY = "schedule:default_view_desktop";
const SETTINGS_CHANGE_EVENT = "schedule-settings-change";

export function getUserSettings(): UserSettings {
  if (typeof window === "undefined") {
    return {
      showHomeworkBadges: true,
      defaultSubgroup: 1,
      defaultViewDesktop: "today",
    };
  }

  let showHomeworkBadges = true;
  try {
    const val = localStorage.getItem(HW_BADGES_KEY);
    if (val !== null) showHomeworkBadges = val !== "false";
  } catch {}

  let defaultSubgroup: number | null = 1;
  try {
    const val = localStorage.getItem(SUBGROUP_KEY);
    if (val === "1" || val === "2") defaultSubgroup = parseInt(val, 10);
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

export function useUserSettings() {
  const [settings, setSettings] = useState<UserSettings>(getUserSettings);

  const reload = useCallback(() => {
    setSettings(getUserSettings());
  }, []);

  useEffect(() => {
    reload();
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key.startsWith("schedule")) {
        reload();
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(SETTINGS_CHANGE_EVENT, reload);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(SETTINGS_CHANGE_EVENT, reload);
    };
  }, [reload]);

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
      window.dispatchEvent(new Event("storage"));
    } catch {}
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  return {
    settings,
    updateSetting,
    reload,
  };
}
