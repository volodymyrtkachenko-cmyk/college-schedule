"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  cancelPendingTopLayerClose,
  closeTopLayer,
  openTopLayer,
  setupClosedByFallback,
} from "@/lib/dialogTopLayer";

export interface AppDialogProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** "modal" centers in all viewports; "sheet" docks to the bottom on mobile (< 640px). */
  variant?: "modal" | "sheet";
  /** CSS max-width value assigned to `--dialog-max-w` (e.g. "500px", "32rem"). */
  maxWidth?: string;
  /** Optional CSS max-height value assigned to `--dialog-max-h`. */
  maxHeight?: string;
  /** Disables both Escape and backdrop click dismissal (e.g. while submitting). */
  closeDisabled?: boolean;
  /** Whether clicking outside the dialog surface requests close (defaults to true). */
  closeOnBackdropClick?: boolean;
  /** Accessible title element id rendered inside the dialog. */
  labelledBy?: string;
  /** Optional accessible description element id rendered inside the dialog. */
  describedBy?: string;
  /** Accessible label fallback when `labelledBy` is not provided. */
  ariaLabel?: string;
  /** Extra classes for the `<dialog>` element itself (avoid setting `display` or `padding`). */
  className?: string;
}

export function AppDialog({
  isOpen,
  onClose,
  children,
  variant = "modal",
  maxWidth = "32rem",
  maxHeight,
  closeDisabled = false,
  closeOnBackdropClick = true,
  labelledBy,
  describedBy,
  ariaLabel,
  className = "",
}: AppDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [keepMountedForExit, setKeepMountedForExit] = useState(isOpen);
  const isOpenRef = useRef(isOpen);
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);

  isOpenRef.current = isOpen;
  onCloseRef.current = onClose;
  closeDisabledRef.current = closeDisabled;

  const closedByMode = closeDisabled
    ? "none"
    : closeOnBackdropClick
      ? "any"
      : "closerequest";

  // Keep native `closedby` attribute/property synced without relying on TS JSX extensions.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.setAttribute("closedby", closedByMode);
    (dialog as HTMLDialogElement & { closedBy?: string }).closedBy = closedByMode;
  }, [closedByMode]);

  // Open / close native top-layer lifecycle.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      setKeepMountedForExit(true);
      openTopLayer(dialog);
      return;
    }

    const cancelClose = closeTopLayer(dialog, () => {
      if (!isOpenRef.current) {
        setKeepMountedForExit(false);
      }
    });
    return cancelClose;
  }, [isOpen]);

  // Ensure unmount cleans up top-layer immediately.
  useEffect(() => {
    const dialog = dialogRef.current;
    return () => {
      if (!dialog) return;
      cancelPendingTopLayerClose(dialog);
      if (dialog.open) {
        dialog.close();
      }
    };
  }, []);

  // Wire Escape cancellation guard, native `close` synchronization, and backdrop fallback.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleCancel = (e: Event) => {
      if (closeDisabledRef.current) {
        e.preventDefault();
      }
    };

    const handleNativeClose = () => {
      if (isOpenRef.current) {
        onCloseRef.current();
      } else {
        setKeepMountedForExit(false);
      }
    };

    dialog.addEventListener("cancel", handleCancel);
    dialog.addEventListener("close", handleNativeClose);

    const teardownFallback = setupClosedByFallback(
      dialog,
      isOpen && !closeDisabled && closeOnBackdropClick,
      () => onCloseRef.current()
    );

    return () => {
      dialog.removeEventListener("cancel", handleCancel);
      dialog.removeEventListener("close", handleNativeClose);
      teardownFallback();
    };
  }, [isOpen, closeDisabled, closeOnBackdropClick]);

  const shouldRenderChildren = isOpen || keepMountedForExit;

  const dialogStyle: React.CSSProperties & {
    "--dialog-max-w"?: string;
    "--dialog-max-h"?: string;
  } = {
    "--dialog-max-w": maxWidth,
    ...(maxHeight ? { "--dialog-max-h": maxHeight } : {}),
  };

  return (
    <dialog
      ref={dialogRef}
      data-variant={variant}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-label={labelledBy ? undefined : ariaLabel}
      style={dialogStyle}
      className={`app-dialog ${className}`.trim()}
    >
      {shouldRenderChildren ? children : null}
    </dialog>
  );
}
