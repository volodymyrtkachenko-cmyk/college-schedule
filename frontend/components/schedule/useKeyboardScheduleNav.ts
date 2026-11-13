"use client";

import { useEffect, useRef } from "react";

interface UseKeyboardScheduleNavParams {
  view: "today" | "week";
  isAnyModalOpen: boolean;
  onOpenContextModal: () => void;
  onJumpToToday: () => void;
  onViewChange: (nextView: "today" | "week") => void;
  onPrevDay: () => void;
  onNextDay: () => void;
  onShiftWeek: (offset: number) => void;
  onSetSubgroup: (subgroup: 1 | 2 | "all") => void;
}

/**
 * Registers desktop keyboard shortcuts (Ctrl+K, /, T, D, W, 1/2/0, ArrowLeft/ArrowRight).
 */
export function useKeyboardScheduleNav({
  view,
  isAnyModalOpen,
  onOpenContextModal,
  onJumpToToday,
  onViewChange,
  onPrevDay,
  onNextDay,
  onShiftWeek,
  onSetSubgroup,
}: UseKeyboardScheduleNavParams) {
  const actionsRef = useRef({
    view,
    isAnyModalOpen,
    onOpenContextModal,
    onJumpToToday,
    onViewChange,
    onPrevDay,
    onNextDay,
    onShiftWeek,
    onSetSubgroup,
  });
  actionsRef.current = {
    view,
    isAnyModalOpen,
    onOpenContextModal,
    onJumpToToday,
    onViewChange,
    onPrevDay,
    onNextDay,
    onShiftWeek,
    onSetSubgroup,
  };

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const {
        view: curView,
        isAnyModalOpen: modalOpen,
        onOpenContextModal: openContextModal,
        onJumpToToday: jumpToToday,
        onViewChange: changeView,
        onPrevDay: prevDay,
        onNextDay: nextDay,
        onShiftWeek: shiftWeek,
        onSetSubgroup: setSubgroup,
      } = actionsRef.current;

      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        openContextModal();
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.tagName === "SELECT" ||
          (activeEl as HTMLElement).isContentEditable)
      ) {
        return;
      }

      if (modalOpen) return;

      if (e.key === "/") {
        e.preventDefault();
        openContextModal();
        return;
      }

      if (e.key === "t" || e.key === "T" || e.key === "е" || e.key === "Е") {
        e.preventDefault();
        jumpToToday();
        return;
      }

      if (e.key === "d" || e.key === "D") {
        e.preventDefault();
        changeView("today");
        return;
      }
      if (e.key === "w" || e.key === "W") {
        e.preventDefault();
        changeView("week");
        return;
      }

      if (e.key === "1") {
        setSubgroup(1);
        return;
      }
      if (e.key === "2") {
        setSubgroup(2);
        return;
      }
      if (e.key === "0") {
        setSubgroup("all");
        return;
      }

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (curView === "today") {
          prevDay();
        } else {
          shiftWeek(-1);
        }
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (curView === "today") {
          nextDay();
        } else {
          shiftWeek(1);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
