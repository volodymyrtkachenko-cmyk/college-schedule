#!/usr/bin/env node

/**
 * Automated WCAG AA Contrast and Palette Class Verifier
 * - Zero external dependencies (pure Node.js)
 * - Reads CSS tokens directly from frontend/app/globals.css
 * - Blends alpha surfaces and calculates relative luminance & contrast ratio
 * - Audits public frontend files for legacy unadapted single-theme palette classes
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

// 1. WCAG Formulas
function sRGBtoLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function relativeLuminance(r, g, b) {
  return 0.2126 * sRGBtoLinear(r) + 0.7152 * sRGBtoLinear(g) + 0.0722 * sRGBtoLinear(b);
}

function contrastRatio(rgb1, rgb2) {
  const L1 = relativeLuminance(rgb1.r, rgb1.g, rgb1.b);
  const L2 = relativeLuminance(rgb2.r, rgb2.g, rgb2.b);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

function parseColorToRgb(str) {
  if (!str) return null;
  const s = str.trim();
  if (s.startsWith("#")) {
    let hex = s.slice(1);
    if (hex.length === 3) {
      hex = hex.split("").map((c) => c + c).join("");
    }
    const num = parseInt(hex.slice(0, 6), 16);
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255,
      a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    };
  }

  // Handle "R G B" space-separated (Tailwind sys tokens)
  const spaceParts = s.split(/\s+/).map(Number);
  if (spaceParts.length === 3 && spaceParts.every((n) => !isNaN(n) && n >= 0 && n <= 255)) {
    return { r: spaceParts[0], g: spaceParts[1], b: spaceParts[2], a: 1 };
  }

  // Handle rgb(...) / rgba(...)
  const match = s.match(/rgba?\s*\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/);
  if (match) {
    return {
      r: parseFloat(match[1]),
      g: parseFloat(match[2]),
      b: parseFloat(match[3]),
      a: match[4] !== undefined ? parseFloat(match[4]) : 1,
    };
  }

  if (s.toLowerCase() === "white") return { r: 255, g: 255, b: 255, a: 1 };
  if (s.toLowerCase() === "black") return { r: 0, g: 0, b: 0, a: 1 };

  return null;
}

function blend(fg, bg, alpha) {
  const a = alpha !== undefined ? alpha : (fg.a !== undefined ? fg.a : 1);
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a)),
    a: 1,
  };
}

// 2. Parse globals.css tokens (base + all 12 accent themes)
function parseTokensFromGlobals() {
  const cssPath = path.join(rootDir, "app", "globals.css");
  const content = fs.readFileSync(cssPath, "utf-8");

  function extractVars(block) {
    const vars = {};
    for (const line of block.split("\n")) {
      const m = line.match(/--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/);
      if (m) {
        const val = m[2].replace(/\/\*.*?\*\//g, "").trim();
        vars[`--${m[1]}`] = val;
      }
    }
    return vars;
  }

  let darkBase = {};
  let lightBase = {};
  const darkAccents = { blue: {} };
  const lightAccents = { blue: {} };

  const darkMatch = content.match(/(?::root|html\.dark|html\[data-theme="dark"\])\s*\{([^}]+)\}/);
  if (darkMatch) darkBase = extractVars(darkMatch[1]);

  const lightMatch = content.match(/(?:html\.light|html\[data-theme="light"\])\s*\{([^}]+)\}/);
  if (lightMatch) lightBase = extractVars(lightMatch[1]);

  for (const accent of ["emerald", "violet", "amber", "rose", "cyan"]) {
    const dRe = new RegExp(`html\\.dark\\[data-accent="${accent}"\\][^{]*\\{([^}]+)\\}`);
    const dM = content.match(dRe);
    if (dM) darkAccents[accent] = extractVars(dM[1]);

    const lRe = new RegExp(`html\\.light\\[data-accent="${accent}"\\][^{]*\\{([^}]+)\\}`);
    const lM = content.match(lRe);
    if (lM) lightAccents[accent] = extractVars(lM[1]);
  }

  return { dark: darkBase, light: lightBase, darkAccents, lightAccents };
}

function resolveColor(desc, tokens, baseBgRgb) {
  if (typeof desc === "string") {
    if (desc.startsWith("--")) {
      const val = tokens[desc];
      if (!val) throw new Error(`Missing CSS token: ${desc}`);
      return parseColorToRgb(val);
    }
    return parseColorToRgb(desc);
  }

  // Object with alpha and over
  if (typeof desc === "object" && desc !== null) {
    const fgRgb = resolveColor(desc.color, tokens, baseBgRgb);
    const bgRgb = desc.over ? resolveColor(desc.over, tokens, baseBgRgb) : baseBgRgb;
    return blend(fgRgb, bgRgb, desc.alpha);
  }

  return null;
}

// 3. Main Contrast Audit
function runContrastChecks() {
  const pairsPath = path.join(__dirname, "contrast-pairs.json");
  if (!fs.existsSync(pairsPath)) {
    console.error("contrast-pairs.json not found!");
    process.exit(1);
  }

  const { themes } = JSON.parse(fs.readFileSync(pairsPath, "utf-8"));
  const tokens = parseTokensFromGlobals();

  let failedCount = 0;
  let totalChecked = 0;

  console.log("\n=======================================================");
  console.log("       WCAG AA CONTRAST AUDIT (college-schedule)       ");
  console.log("=======================================================\n");

  for (const themeName of ["dark", "light"]) {
    console.log(`--- Theme: ${themeName.toUpperCase()} (Base / Blue) ---`);
    const themeConfig = themes[themeName];
    const themeTokens = tokens[themeName];
    const baseBgRgb = parseColorToRgb(themeConfig.baseBg);

    for (const pair of themeConfig.pairs) {
      totalChecked++;
      try {
        const fgRgb = resolveColor(pair.fg, themeTokens, baseBgRgb);
        const bgRgb = resolveColor(pair.bg, themeTokens, baseBgRgb);
        const cr = contrastRatio(fgRgb, bgRgb);
        const passed = cr >= pair.threshold;
        const crFormatted = cr.toFixed(2);

        if (!passed) {
          failedCount++;
          console.log(`  ❌ FAIL: ${pair.name} -> ${crFormatted}:1 (required: ${pair.threshold}:1)`);
        } else {
          console.log(`  ✓ PASS: ${pair.name} -> ${crFormatted}:1 (≥ ${pair.threshold}:1)`);
        }
      } catch (err) {
        failedCount++;
        console.log(`  ❌ ERROR checking "${pair.name}": ${err.message}`);
      }
    }
    console.log("");

    // Also audit all 6 accent variants for this mode
    const accentMap = themeName === "dark" ? tokens.darkAccents : tokens.lightAccents;
    for (const [accentName, overrides] of Object.entries(accentMap)) {
      const merged = { ...themeTokens, ...overrides };
      const bgRgb = parseColorToRgb(merged["--sys-bg"]);
      const surfaces = ["--sys-bg", "--sys-card", "--sys-elevated", "--sys-input", "--sys-tab-active"];
      for (const sKey of surfaces) {
        const sRgb = parseColorToRgb(merged[sKey]);
        const checks = [
          ["--sys-text-primary", 7.0],
          ["--sys-text-secondary", 4.5],
          ["--sys-text-muted", 4.5],
          ["--sys-accent", 4.5],
        ];
        for (const [fgKey, minCr] of checks) {
          totalChecked++;
          const fgRgb = parseColorToRgb(merged[fgKey]);
          const cr = contrastRatio(fgRgb, sRgb);
          if (cr < minCr) {
            failedCount++;
            console.log(`  ❌ FAIL [${themeName}:${accentName}]: ${fgKey} on ${sKey} -> ${cr.toFixed(2)}:1 (< ${minCr}:1)`);
          }
        }
      }
      // Solid button contrast check
      totalChecked++;
      const solidBg = parseColorToRgb(merged["--sys-accent-solid"]);
      const onAccent = parseColorToRgb(merged["--sys-on-accent"]);
      const solidCr = contrastRatio(onAccent, solidBg);
      if (solidCr < 4.5) {
        failedCount++;
        console.log(`  ❌ FAIL [${themeName}:${accentName}]: --sys-on-accent on --sys-accent-solid -> ${solidCr.toFixed(2)}:1 (< 4.5:1)`);
      }
    }
  }
  console.log("  ✓ Checked all 12 theme × accent combinations across all surfaces and solid buttons.\n");

  return { failedCount, totalChecked };
}

function getAllTsxFiles(dir, baseDir = dir) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(getAllTsxFiles(full, baseDir));
    } else if (entry.name.endsWith(".tsx")) {
      results.push(path.relative(baseDir, full));
    }
  }
  return results;
}

// 4. Audit All TSX Files for Unadapted Single-Theme Pastel Text Classes
function auditLegacyClasses() {
  console.log("-------------------------------------------------------");
  console.log("       AUDIT OF UNADAPTED PALETTE CLASSES IN ALL TSX FILES");
  console.log("-------------------------------------------------------\n");

  const allTsxFiles = [
    ...getAllTsxFiles(path.join(rootDir, "app"), rootDir),
    ...getAllTsxFiles(path.join(rootDir, "components"), rootDir),
  ];

  const publicNoTransitionAll = new Set([
    "components/WeekTypeBadge.tsx",
    "components/LessonCard.tsx",
    "components/lesson-card/LessonCardMeetingControls.tsx",
    "components/lesson-card/LessonCardStatusBadges.tsx",
    "components/lesson-card/LessonCardActions.tsx",
    "components/lesson-card/SubgroupTeacherBlock.tsx",
    "components/lesson-card/LessonTasksPanel.tsx",
    "components/SchedulePageClient.tsx",
    "components/schedule/ContextSelectionModal.tsx",
    "components/schedule/DesktopFocusDaySwitcher.tsx",
    "components/schedule/DesktopScheduleSidebar.tsx",
    "components/schedule/DesktopToolbar.tsx",
    "components/schedule/DesktopWeekHeaderBar.tsx",
    "components/schedule/MobileChrome.tsx",
    "components/schedule/ScheduleStateCards.tsx",
    "components/schedule/WeekTypeBottomSheet.tsx",
    "components/ScheduleDay.tsx",
    "components/ScheduleWeekGrid.tsx",
    "components/MobileWeekDaysStrip.tsx",
    "components/BottomNav.tsx",
    "components/OfflineIndicator.tsx",
    "components/TaskFilters.tsx",
    "components/MobileTasksView.tsx",
    "components/TeacherPinModal.tsx",
    "app/page.tsx",
    "app/settings/page.tsx",
  ]);

  let violationCount = 0;

  const COLOR_RE = /\btext-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(100|200|300|400)(?:\/[0-9]+)?\b/g;

  for (const relPath of allTsxFiles) {
    const fullPath = path.join(rootDir, relPath);
    if (!fs.existsSync(fullPath)) continue;

    const content = fs.readFileSync(fullPath, "utf-8");
    const lines = content.split("\n");

    lines.forEach((line, idx) => {
      let match;
      COLOR_RE.lastIndex = 0;
      while ((match = COLOR_RE.exec(line)) !== null) {
        const fullMatch = match[0];
        const prefix = line.slice(Math.max(0, match.index - 12), match.index);
        if (prefix.endsWith("dark:") || prefix.endsWith("dark:hover:") || prefix.endsWith("dark:group-hover:")) continue;
        // Skip intentional dark badge surface in OfficialPrintSheet
        if (line.includes("bg-slate-900") && line.includes("print:")) continue;

        const hasLightCounterpart = /\btext-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:600|700|800|900|950)\b/.test(line)
          || line.includes("dark:text-");
        if (!hasLightCounterpart) {
          console.log(`  ⚠️ [${relPath}:${idx + 1}] Unadapted pastel text class without light-mode counterpart -> ${fullMatch}`);
          violationCount++;
        }
      }

      if (publicNoTransitionAll.has(relPath) && line.match(/(?<![a-zA-Z0-9_\-:])transition-all\b/)) {
        console.log(`  ⚠️ [${relPath}:${idx + 1}] Found unoptimized transition-all in core public file`);
        violationCount++;
      }
    });
  }

  if (violationCount === 0) {
    console.log(`  ✓ Audited ${allTsxFiles.length} TSX files: 0 unadapted pastel text classes found!\n`);
  } else {
    console.log(`\n  ⚠️ Total violations: ${violationCount}\n`);
  }

  return violationCount;
}

const { failedCount, totalChecked } = runContrastChecks();
const legacyViolations = auditLegacyClasses();

console.log("=======================================================");
console.log(`Summary: ${totalChecked - failedCount}/${totalChecked} contrast pairs passed.`);
if (failedCount > 0 || legacyViolations > 0) {
  console.log(`Status: FAILED (${failedCount} contrast failures, ${legacyViolations} legacy palette violations)\n`);
  process.exit(1);
} else {
  console.log("Status: ALL CHECKS PASSED ✅\n");
  process.exit(0);
}
