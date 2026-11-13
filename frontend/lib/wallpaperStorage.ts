"use client";

import { VISUAL_WALLPAPER_META_KEY } from "./visualStudio";

const DB_NAME = "dfkr_visual_studio_db";
const DB_VERSION = 1;
const STORE_NAME = "wallpapers";
const ACTIVE_KEY = "active_wallpaper";
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_DIMENSION = 1920;

export interface WallpaperMeta {
  hasCustom: boolean;
  dominantHex: string | null;
  tinyPlaceholder: string | null;
  updatedAt: number;
}

export interface StoredWallpaperRecord {
  id: string;
  blob: Blob;
  dominantHex: string;
  tinyPlaceholder: string;
  updatedAt: number;
}

function openWallpaperDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !("indexedDB" in window)) {
      reject(new Error("IndexedDB недоступний у цьому браузері."));
      return;
    }
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Не вдалося відкрити сховище шпалер."));
  });
}

function loadImageElement(objectUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Не вдалося декодувати зображення."));
    img.src = objectUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mime, quality);
  });
}

function sampleDominantHex(canvas: HTMLCanvasElement): string {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return "#111a2e";
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 20) continue;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    count++;
  }
  if (!count) return "#111a2e";
  const hex = (n: number) => Math.round(n / count).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

async function compressWallpaperFile(file: File): Promise<StoredWallpaperRecord> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Оберіть файл зображення (PNG, JPG або WebP).");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("Файл завеликий. Оберіть зображення до 20 МБ.");
  }

  const tempUrl = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(tempUrl);
    const srcW = Math.max(1, img.naturalWidth || img.width || 1);
    const srcH = Math.max(1, img.naturalHeight || img.height || 1);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(srcW, srcH));
    const targetW = Math.max(1, Math.round(srcW * scale));
    const targetH = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Браузер не підтримує обробку зображень Canvas.");
    }
    ctx.drawImage(img, 0, 0, targetW, targetH);

    // Tiny blurred placeholder stored synchronously in localStorage (~1 KB) for instant boot tint
    const tinyCanvas = document.createElement("canvas");
    tinyCanvas.width = 24;
    tinyCanvas.height = 24;
    const tinyCtx = tinyCanvas.getContext("2d");
    let dominantHex = "#111a2e";
    let tinyPlaceholder = "";
    if (tinyCtx) {
      tinyCtx.drawImage(img, 0, 0, 24, 24);
      dominantHex = sampleDominantHex(tinyCanvas);
      tinyPlaceholder = tinyCanvas.toDataURL("image/jpeg", 0.55);
    }

    const webpBlob = await canvasToBlob(canvas, "image/webp", 0.86);
    const finalBlob = webpBlob && webpBlob.size > 0
      ? webpBlob
      : await canvasToBlob(canvas, "image/jpeg", 0.86);

    if (!finalBlob) {
      throw new Error("Не вдалося оптимізувати зображення.");
    }

    return {
      id: ACTIVE_KEY,
      blob: finalBlob,
      dominantHex,
      tinyPlaceholder,
      updatedAt: Date.now(),
    };
  } finally {
    URL.revokeObjectURL(tempUrl);
  }
}

export function readWallpaperMeta(): WallpaperMeta | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(VISUAL_WALLPAPER_META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WallpaperMeta>;
    if (!parsed || typeof parsed !== "object" || !parsed.hasCustom) return null;
    return {
      hasCustom: true,
      dominantHex: typeof parsed.dominantHex === "string" ? parsed.dominantHex : null,
      tinyPlaceholder: typeof parsed.tinyPlaceholder === "string" ? parsed.tinyPlaceholder : null,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

export function clearWallpaperMeta(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(VISUAL_WALLPAPER_META_KEY);
  } catch {}
}

export async function saveCustomWallpaper(file: File): Promise<WallpaperMeta> {
  const record = await compressWallpaperFile(file);
  const db = await openWallpaperDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Помилка запису шпалер у сховище."));
    });
  } finally {
    db.close();
  }

  const meta: WallpaperMeta = {
    hasCustom: true,
    dominantHex: record.dominantHex,
    tinyPlaceholder: record.tinyPlaceholder,
    updatedAt: record.updatedAt,
  };
  try {
    localStorage.setItem(VISUAL_WALLPAPER_META_KEY, JSON.stringify(meta));
  } catch {}
  return meta;
}

export async function loadCustomWallpaperBlob(): Promise<StoredWallpaperRecord | null> {
  try {
    const db = await openWallpaperDb();
    try {
      return await new Promise<StoredWallpaperRecord | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(ACTIVE_KEY);
        req.onsuccess = () => resolve((req.result as StoredWallpaperRecord) || null);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export async function deleteCustomWallpaper(): Promise<void> {
  clearWallpaperMeta();
  try {
    const db = await openWallpaperDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(ACTIVE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {}
}
