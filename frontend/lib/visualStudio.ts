export type BaseThemeMode = "light" | "dark" | "system";
export type ResolvedThemeMode = "light" | "dark";
export type StockAccentColor = "blue" | "emerald" | "violet" | "amber" | "rose" | "cyan";
export type AccentSelection = StockAccentColor | "custom";

export type SurfaceMaterial = "matte" | "oled" | "glass" | "outline";
export type BackdropPreset = "none" | "aurora" | "dots" | "blueprint" | "silk" | "custom";
export type FontPreset = "sans" | "tech" | "soft";
export type RadiusPreset = "sharp" | "default" | "soft";
export type DensityPreset = "compact" | "default" | "relaxed";

export interface VisualStudioConfig {
  surface: SurfaceMaterial;
  backdrop: BackdropPreset;
  fontPreset: FontPreset;
  radius: RadiusPreset;
  density: DensityPreset;
  customHue: number;
  customSaturation: number;
  wallpaperBlur: number;
  wallpaperDim: number;
  wallpaperTint: string | null;
}

export interface CustomThemeVars {
  bgHex: string;
  cardHex: string;
  vars: Record<string, string>;
}

export interface CuratedStylePreset {
  id: string;
  name: string;
  subtitle: string;
  accent: StockAccentColor;
  previewSwatches: [string, string, string];
  config: Partial<VisualStudioConfig>;
}

export const VISUAL_STUDIO_STORAGE_KEY = "college_visual_studio_v1";
export const VISUAL_CUSTOM_VARS_STORAGE_KEY = "college_visual_custom_vars_v1";
export const VISUAL_WALLPAPER_META_KEY = "college_visual_wallpaper_meta_v1";
export const VISUAL_CHANGE_EVENT = "college-visual-studio-change";

export const DEFAULT_VISUAL_CONFIG: VisualStudioConfig = {
  surface: "matte",
  backdrop: "none",
  fontPreset: "sans",
  radius: "default",
  density: "default",
  customHue: 217,
  customSaturation: 82,
  wallpaperBlur: 10,
  wallpaperDim: 48,
  wallpaperTint: null,
};

export const SURFACE_OPTIONS: Array<{
  id: SurfaceMaterial;
  label: string;
  hint: string;
}> = [
  { id: "matte", label: "Класичний", hint: "М'які непрозорі картки" },
  { id: "oled", label: "OLED / Чистий", hint: "Глибокий чорний або чистий білий" },
  { id: "glass", label: "Матове скло", hint: "Напівпрозорість і розмиття" },
  { id: "outline", label: "Контурний", hint: "Чіткі графічні рамки без тіней" },
];

export const BACKDROP_OPTIONS: Array<{
  id: BackdropPreset;
  label: string;
  hint: string;
}> = [
  { id: "none", label: "Чистий", hint: "Спокійне стандартне тло" },
  { id: "aurora", label: "Північне сяйво", hint: "М'які світлові плями акценту" },
  { id: "dots", label: "Матриця точок", hint: "Акуратний інженерний ритм" },
  { id: "blueprint", label: "Радіосхема", hint: "Креслення у стилі ДФКР" },
  { id: "silk", label: "Шовк", hint: "Глибокий градієнт і мікрозерно" },
  { id: "custom", label: "Своє фото", hint: "Власні шпалери з пристрою" },
];

export const FONT_OPTIONS: Array<{
  id: FontPreset;
  label: string;
  hint: string;
  sample: string;
}> = [
  { id: "sans", label: "Класичний", hint: "Збалансований гротеск", sample: "10:40" },
  { id: "tech", label: "Техно", hint: "Моно-цифри, час та аудиторії", sample: "10:40" },
  { id: "soft", label: "М'який", hint: "Округлі дружні літери", sample: "10:40" },
];

export const RADIUS_OPTIONS: Array<{
  id: RadiusPreset;
  label: string;
  pxHint: string;
}> = [
  { id: "sharp", label: "Строгий", pxHint: "6 px" },
  { id: "default", label: "Стандарт", pxHint: "16 px" },
  { id: "soft", label: "М'який", pxHint: "24 px" },
];

export const DENSITY_OPTIONS: Array<{
  id: DensityPreset;
  label: string;
  hint: string;
}> = [
  { id: "compact", label: "Компакт", hint: "Більше пар на одному екрані" },
  { id: "default", label: "Стандарт", hint: "Збалансовані відступи" },
  { id: "relaxed", label: "Просторий", hint: "Більше повітря в картках" },
];

export const QUICK_CUSTOM_HUES: Array<{ label: string; hue: number; sat: number }> = [
  { label: "Ультрамарин", hue: 226, sat: 84 },
  { label: "Індіго", hue: 252, sat: 78 },
  { label: "Фуксія", hue: 312, sat: 80 },
  { label: "Теракота", hue: 14, sat: 82 },
  { label: "Золото", hue: 42, sat: 86 },
  { label: "Нефрит", hue: 162, sat: 76 },
];

export const CURATED_STYLE_PRESETS: CuratedStylePreset[] = [
  {
    id: "classic",
    name: "Класика ДФКР",
    subtitle: "Океан · Матовий · Збалансований",
    accent: "blue",
    previewSwatches: ["#080d18", "#111a2e", "#3b82f6"],
    config: {
      surface: "matte",
      backdrop: "none",
      fontPreset: "sans",
      radius: "default",
      density: "default",
    },
  },
  {
    id: "amoled",
    name: "AMOLED Мінімал",
    subtitle: "Чистий чорний/білий · Компакт",
    accent: "blue",
    previewSwatches: ["#000000", "#0b0d13", "#60a5fa"],
    config: {
      surface: "oled",
      backdrop: "none",
      fontPreset: "sans",
      radius: "default",
      density: "compact",
    },
  },
  {
    id: "aurora-glass",
    name: "Північне скло",
    subtitle: "Аврора · Скло · М'які кути",
    accent: "cyan",
    previewSwatches: ["#061117", "#0f3142", "#22d3ee"],
    config: {
      surface: "glass",
      backdrop: "aurora",
      fontPreset: "soft",
      radius: "soft",
      density: "default",
    },
  },
  {
    id: "radio-terminal",
    name: "Радіотехнік",
    subtitle: "Схема · Контури · Техно-цифри",
    accent: "emerald",
    previewSwatches: ["#06120e", "#102820", "#34d399"],
    config: {
      surface: "outline",
      backdrop: "blueprint",
      fontPreset: "tech",
      radius: "sharp",
      density: "compact",
    },
  },
  {
    id: "silk-lounge",
    name: "Тихий шовк",
    subtitle: "Шовк · Скло · Просторий",
    accent: "violet",
    previewSwatches: ["#0d0917", "#21183c", "#c084fc"],
    config: {
      surface: "glass",
      backdrop: "silk",
      fontPreset: "sans",
      radius: "soft",
      density: "relaxed",
    },
  },
];

const STOCK_ACCENTS = new Set<StockAccentColor>(["blue", "emerald", "violet", "amber", "rose", "cyan"]);
const SURFACES = new Set<SurfaceMaterial>(["matte", "oled", "glass", "outline"]);
const BACKDROPS = new Set<BackdropPreset>(["none", "aurora", "dots", "blueprint", "silk", "custom"]);
const FONTS = new Set<FontPreset>(["sans", "tech", "soft"]);
const RADII = new Set<RadiusPreset>(["sharp", "default", "soft"]);
const DENSITIES = new Set<DensityPreset>(["compact", "default", "relaxed"]);

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

export function normalizeHue(hue: unknown, fallback = DEFAULT_VISUAL_CONFIG.customHue): number {
  const num = Number(hue);
  if (!Number.isFinite(num)) return fallback;
  const mod = Math.round(num) % 360;
  return mod < 0 ? mod + 360 : mod;
}

export function sanitizeVisualConfig(raw: unknown): VisualStudioConfig {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_VISUAL_CONFIG };
  }
  const src = raw as Record<string, unknown>;
  return {
    surface: SURFACES.has(src.surface as SurfaceMaterial)
      ? (src.surface as SurfaceMaterial)
      : DEFAULT_VISUAL_CONFIG.surface,
    backdrop: BACKDROPS.has(src.backdrop as BackdropPreset)
      ? (src.backdrop as BackdropPreset)
      : DEFAULT_VISUAL_CONFIG.backdrop,
    fontPreset: FONTS.has(src.fontPreset as FontPreset)
      ? (src.fontPreset as FontPreset)
      : DEFAULT_VISUAL_CONFIG.fontPreset,
    radius: RADII.has(src.radius as RadiusPreset)
      ? (src.radius as RadiusPreset)
      : DEFAULT_VISUAL_CONFIG.radius,
    density: DENSITIES.has(src.density as DensityPreset)
      ? (src.density as DensityPreset)
      : DEFAULT_VISUAL_CONFIG.density,
    customHue: normalizeHue(src.customHue, DEFAULT_VISUAL_CONFIG.customHue),
    customSaturation: clampNumber(src.customSaturation, 35, 100, DEFAULT_VISUAL_CONFIG.customSaturation),
    wallpaperBlur: clampNumber(src.wallpaperBlur, 0, 24, DEFAULT_VISUAL_CONFIG.wallpaperBlur),
    wallpaperDim: clampNumber(src.wallpaperDim, 10, 85, DEFAULT_VISUAL_CONFIG.wallpaperDim),
    wallpaperTint:
      typeof src.wallpaperTint === "string" && /^#[0-9a-fA-F]{6}$/.test(src.wallpaperTint)
        ? src.wallpaperTint
        : null,
  };
}

export interface RGBColor {
  r: number;
  g: number;
  b: number;
}

export function hslToRgb(hDeg: number, sPct: number, lPct: number): RGBColor {
  const h = (((hDeg % 360) + 360) % 360) / 360;
  const s = Math.max(0, Math.min(100, sPct)) / 100;
  const l = Math.max(0, Math.min(100, lPct)) / 100;

  if (s === 0) {
    const val = Math.round(l * 255);
    return { r: val, g: val, b: val };
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };

  return {
    r: Math.round(hue2rgb(h + 1 / 3) * 255),
    g: Math.round(hue2rgb(h) * 255),
    b: Math.round(hue2rgb(h - 1 / 3) * 255),
  };
}

function sRgbToLinear(channel: number): number {
  const v = channel / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(rgb: RGBColor): number {
  return 0.2126 * sRgbToLinear(rgb.r) + 0.7152 * sRgbToLinear(rgb.g) + 0.0722 * sRgbToLinear(rgb.b);
}

export function contrastRatio(a: RGBColor, b: RGBColor): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function rgbToSpaceTuple(rgb: RGBColor): string {
  return `${rgb.r} ${rgb.g} ${rgb.b}`;
}

export function rgbToHex(rgb: RGBColor): string {
  const toHex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

function findLightnessAboveContrast(
  hue: number,
  sat: number,
  targetBg: RGBColor,
  minRatio: number,
  startL: number,
  direction: "up" | "down"
): RGBColor {
  let candidate = hslToRgb(hue, sat, startL);
  if (contrastRatio(candidate, targetBg) >= minRatio) {
    return candidate;
  }
  const step = direction === "up" ? 1 : -1;
  for (let l = startL + step; direction === "up" ? l <= 98 : l >= 6; l += step) {
    candidate = hslToRgb(hue, sat, l);
    if (contrastRatio(candidate, targetBg) >= minRatio) {
      return candidate;
    }
  }
  return candidate;
}

const WHITE_RGB: RGBColor = { r: 255, g: 255, b: 255 };

/**
 * Computes harmonized WCAG AA/AAA tokens for any custom hue/saturation
 * across both dark/light themes and surface presets (including OLED).
 */
export function buildCustomAccentVars(
  rawHue: number,
  rawSat: number,
  resolvedTheme: ResolvedThemeMode,
  surface: SurfaceMaterial = "matte"
): CustomThemeVars {
  const hue = normalizeHue(rawHue);
  const sat = clampNumber(rawSat, 35, 100, 82);
  const isOled = surface === "oled";

  if (resolvedTheme === "dark") {
    const bgRgb = isOled ? { r: 0, g: 0, b: 0 } : hslToRgb(hue, Math.min(46, Math.round(sat * 0.52)), 6.5);
    const cardRgb = isOled ? { r: 10, g: 12, b: 18 } : hslToRgb(hue, Math.min(44, Math.round(sat * 0.5)), 11.5);
    const elevatedRgb = isOled ? { r: 18, g: 22, b: 32 } : hslToRgb(hue, Math.min(44, Math.round(sat * 0.48)), 16.5);
    const inputRgb = isOled ? { r: 7, g: 9, b: 14 } : hslToRgb(hue, Math.min(44, Math.round(sat * 0.5)), 8.5);
    const tabActiveRgb = isOled ? { r: 24, g: 29, b: 42 } : hslToRgb(hue, Math.min(46, Math.round(sat * 0.5)), 20);
    const borderRgb = isOled ? { r: 36, g: 42, b: 58 } : hslToRgb(hue, Math.min(42, Math.round(sat * 0.48)), 22);
    const borderChipRgb = isOled ? { r: 58, g: 68, b: 92 } : hslToRgb(hue, Math.min(42, Math.round(sat * 0.46)), 31);

    const textPrimaryRgb = hslToRgb(hue, 40, 97);
    const textSecondaryRgb = findLightnessAboveContrast(hue, 28, tabActiveRgb, 7.2, 82, "up");
    const textMutedRgb = findLightnessAboveContrast(hue, 24, tabActiveRgb, 5.1, 64, "up");

    const accentRgb = findLightnessAboveContrast(hue, Math.min(92, sat + 4), tabActiveRgb, 5.1, 70, "up");
    const accentSolidRgb = findLightnessAboveContrast(hue, Math.min(90, sat), WHITE_RGB, 4.85, 50, "down");

    const bgHex = rgbToHex(bgRgb);
    const cardHex = rgbToHex(cardRgb);
    const accentHex = rgbToHex(accentRgb);
    const accentSolidHex = rgbToHex(accentSolidRgb);

    return {
      bgHex,
      cardHex,
      vars: {
        "--page-bg": bgHex,
        "--bg": bgHex,
        "--surface": cardHex,
        "--border": rgbToHex(borderRgb),
        "--border-chip": rgbToHex(borderChipRgb),
        "--accent": accentHex,
        "--accent-solid": accentSolidHex,
        "--sys-bg": rgbToSpaceTuple(bgRgb),
        "--sys-card": rgbToSpaceTuple(cardRgb),
        "--sys-surface": rgbToSpaceTuple(cardRgb),
        "--sys-elevated": rgbToSpaceTuple(elevatedRgb),
        "--sys-elevated-border": rgbToSpaceTuple(borderChipRgb),
        "--sys-border": rgbToSpaceTuple(borderRgb),
        "--sys-input": rgbToSpaceTuple(inputRgb),
        "--sys-tab-active": rgbToSpaceTuple(tabActiveRgb),
        "--sys-accent": rgbToSpaceTuple(accentRgb),
        "--sys-accent-solid": rgbToSpaceTuple(accentSolidRgb),
        "--sys-neon": rgbToSpaceTuple(accentRgb),
        "--sys-text-subject": "255 255 255",
        "--sys-text-primary": rgbToSpaceTuple(textPrimaryRgb),
        "--sys-text-secondary": rgbToSpaceTuple(textSecondaryRgb),
        "--sys-text-muted": rgbToSpaceTuple(textMutedRgb),
      },
    };
  }

  // Light theme
  const bgRgb = isOled ? WHITE_RGB : hslToRgb(hue, Math.min(55, Math.round(sat * 0.65)), 95.5);
  const cardRgb = WHITE_RGB;
  const surfaceRgb = isOled ? { r: 248, g: 250, b: 252 } : hslToRgb(hue, Math.min(50, Math.round(sat * 0.6)), 98);
  const elevatedRgb = isOled ? { r: 241, g: 245, b: 249 } : hslToRgb(hue, Math.min(62, Math.round(sat * 0.72)), 92);
  const inputRgb = isOled ? { r: 244, g: 247, b: 251 } : hslToRgb(hue, Math.min(55, Math.round(sat * 0.65)), 94.5);
  const tabActiveRgb = hslToRgb(hue, isOled ? 42 : Math.min(70, Math.round(sat * 0.78)), isOled ? 90 : 88.5);
  const borderRgb = isOled ? { r: 203, g: 213, b: 225 } : hslToRgb(hue, Math.min(44, Math.round(sat * 0.52)), 82);
  const borderChipRgb = isOled ? { r: 148, g: 163, b: 184 } : hslToRgb(hue, Math.min(46, Math.round(sat * 0.55)), 71);

  const textSubjectRgb = hslToRgb(hue, 45, 10);
  const textPrimaryRgb = findLightnessAboveContrast(hue, 40, tabActiveRgb, 11.0, 14, "down");
  const textSecondaryRgb = findLightnessAboveContrast(hue, 32, tabActiveRgb, 7.2, 26, "down");
  const textMutedRgb = findLightnessAboveContrast(hue, 26, tabActiveRgb, 5.1, 38, "down");

  const accentRgb = findLightnessAboveContrast(hue, Math.min(90, sat), tabActiveRgb, 5.1, 40, "down");
  const accentSolidRgb = findLightnessAboveContrast(hue, Math.min(90, sat), WHITE_RGB, 4.85, 45, "down");

  const bgHex = rgbToHex(bgRgb);
  const cardHex = rgbToHex(cardRgb);
  const accentHex = rgbToHex(accentRgb);
  const accentSolidHex = rgbToHex(accentSolidRgb);

  return {
    bgHex,
    cardHex,
    vars: {
      "--page-bg": bgHex,
      "--bg": bgHex,
      "--surface": cardHex,
      "--border": rgbToHex(borderRgb),
      "--border-chip": rgbToHex(borderChipRgb),
      "--accent": accentHex,
      "--accent-solid": accentSolidHex,
      "--sys-bg": rgbToSpaceTuple(bgRgb),
      "--sys-card": rgbToSpaceTuple(cardRgb),
      "--sys-surface": rgbToSpaceTuple(surfaceRgb),
      "--sys-elevated": rgbToSpaceTuple(elevatedRgb),
      "--sys-elevated-border": rgbToSpaceTuple(borderChipRgb),
      "--sys-border": rgbToSpaceTuple(borderRgb),
      "--sys-input": rgbToSpaceTuple(inputRgb),
      "--sys-tab-active": rgbToSpaceTuple(tabActiveRgb),
      "--sys-accent": rgbToSpaceTuple(accentRgb),
      "--sys-accent-solid": rgbToSpaceTuple(accentSolidRgb),
      "--sys-neon": rgbToSpaceTuple(accentRgb),
      "--sys-text-subject": rgbToSpaceTuple(textSubjectRgb),
      "--sys-text-primary": rgbToSpaceTuple(textPrimaryRgb),
      "--sys-text-secondary": rgbToSpaceTuple(textSecondaryRgb),
      "--sys-text-muted": rgbToSpaceTuple(textMutedRgb),
    },
  };
}

export const CUSTOM_CSS_VAR_KEYS = [
  "--page-bg",
  "--bg",
  "--surface",
  "--border",
  "--border-chip",
  "--accent",
  "--accent-solid",
  "--sys-bg",
  "--sys-card",
  "--sys-surface",
  "--sys-elevated",
  "--sys-elevated-border",
  "--sys-border",
  "--sys-input",
  "--sys-tab-active",
  "--sys-accent",
  "--sys-accent-solid",
  "--sys-neon",
  "--sys-text-subject",
  "--sys-text-primary",
  "--sys-text-secondary",
  "--sys-text-muted",
] as const;

export interface EncodedThemeResult {
  code: string;
  droppedCustomWallpaper: boolean;
}

export function encodeThemeShareCode(
  accent: AccentSelection,
  config: VisualStudioConfig
): EncodedThemeResult {
  const safe = sanitizeVisualConfig(config);
  const droppedCustomWallpaper = safe.backdrop === "custom";
  const shareBackdrop: BackdropPreset = droppedCustomWallpaper ? "aurora" : safe.backdrop;
  const accentToken =
    accent === "custom" ? `c${safe.customHue}s${safe.customSaturation}` : STOCK_ACCENTS.has(accent) ? accent : "blue";

  return {
    code: `DFKR1.${safe.surface}.${shareBackdrop}.${safe.fontPreset}.${safe.radius}.${safe.density}.${accentToken}`,
    droppedCustomWallpaper,
  };
}

export interface DecodedThemeResult {
  accent: AccentSelection;
  config: Partial<VisualStudioConfig>;
}

export function decodeThemeShareCode(rawInput: string): DecodedThemeResult | null {
  const trimmed = String(rawInput || "").trim();
  if (!trimmed) return null;
  const parts = trimmed.split(".");
  if (parts.length !== 7 || parts[0].toUpperCase() !== "DFKR1") {
    return null;
  }

  const surface = parts[1].toLowerCase() as SurfaceMaterial;
  const backdrop = parts[2].toLowerCase() as BackdropPreset;
  const fontPreset = parts[3].toLowerCase() as FontPreset;
  const radius = parts[4].toLowerCase() as RadiusPreset;
  const density = parts[5].toLowerCase() as DensityPreset;
  const accentRaw = parts[6].toLowerCase();

  if (
    !SURFACES.has(surface) ||
    !BACKDROPS.has(backdrop) ||
    backdrop === "custom" ||
    !FONTS.has(fontPreset) ||
    !RADII.has(radius) ||
    !DENSITIES.has(density)
  ) {
    return null;
  }

  if (STOCK_ACCENTS.has(accentRaw as StockAccentColor)) {
    return {
      accent: accentRaw as StockAccentColor,
      config: { surface, backdrop, fontPreset, radius, density },
    };
  }

  const customMatch = accentRaw.match(/^c(\d{1,3})s(\d{1,3})$/);
  if (!customMatch) {
    return null;
  }

  const hue = Number(customMatch[1]);
  const sat = Number(customMatch[2]);
  if (hue < 0 || hue > 359 || sat < 35 || sat > 100) {
    return null;
  }

  return {
    accent: "custom",
    config: {
      surface,
      backdrop,
      fontPreset,
      radius,
      density,
      customHue: hue,
      customSaturation: sat,
    },
  };
}

export function matchesCuratedPreset(
  preset: CuratedStylePreset,
  accent: AccentSelection,
  config: VisualStudioConfig
): boolean {
  if (accent !== preset.accent) return false;
  return (
    (preset.config.surface ?? "matte") === config.surface &&
    (preset.config.backdrop ?? "none") === config.backdrop &&
    (preset.config.fontPreset ?? "sans") === config.fontPreset &&
    (preset.config.radius ?? "default") === config.radius &&
    (preset.config.density ?? "default") === config.density
  );
}
