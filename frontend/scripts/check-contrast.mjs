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

// 2. Parse globals.css tokens
function parseTokensFromGlobals() {
  const cssPath = path.join(rootDir, "app", "globals.css");
  const content = fs.readFileSync(cssPath, "utf-8");

  const darkTokens = {};
  const lightTokens = {};

  // Extract dark section
  const darkMatch = content.match(/(?::root|html\.dark|html\[data-theme="dark"\])\s*\{([^}]+)\}/);
  if (darkMatch) {
    for (const line of darkMatch[1].split("\n")) {
      const m = line.match(/--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/);
      if (m) {
        // Strip trailing inline comment e.g. /* #121722 */
        const val = m[2].replace(/\/\*.*?\*\//g, "").trim();
        darkTokens[`--${m[1]}`] = val;
      }
    }
  }

  // Extract light section
  const lightMatch = content.match(/(?:html\.light|html\[data-theme="light"\])\s*\{([^}]+)\}/);
  if (lightMatch) {
    for (const line of lightMatch[1].split("\n")) {
      const m = line.match(/--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/);
      if (m) {
        const val = m[2].replace(/\/\*.*?\*\//g, "").trim();
        lightTokens[`--${m[1]}`] = val;
      }
    }
  }

  return { dark: darkTokens, light: lightTokens };
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
    console.log(`--- Theme: ${themeName.toUpperCase()} ---`);
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
  }

  return { failedCount, totalChecked };
}

// 4. Audit Public Files for Legacy Unadapted Single-Theme Palette Classes
function auditLegacyClasses() {
  console.log("-------------------------------------------------------");
  console.log("       AUDIT OF UNADAPTED PALETTE CLASSES IN PUBLIC FILES");
  console.log("-------------------------------------------------------\n");

  const publicFiles = [
    "components/WeekTypeBadge.tsx",
    "components/LessonCard.tsx",
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
  ];

  let violationCount = 0;

  // Patterns that indicate unadapted single-theme classes that lack dark: alternative on the element
  // or problematic transition-all in public files
  for (const relPath of publicFiles) {
    const fullPath = path.join(rootDir, relPath);
    if (!fs.existsSync(fullPath)) continue;

    const content = fs.readFileSync(fullPath, "utf-8");
    const lines = content.split("\n");

  lines.forEach((line, idx) => {
      // Check for legacy washed-out text classes without dark: variant
      const classMatches = line.match(/(?<![a-zA-Z0-9_\-:])(text-(?:amber|rose|emerald|sky|purple)-(?:200|300))\b/g);
      if (classMatches) {
        for (const cls of classMatches) {
          if (!line.includes("dark:text-") && !line.includes("dark:text[")) {
            console.log(`  ⚠️ [${relPath}:${idx + 1}] Legacy single-theme color without dark: variant -> ${cls}`);
            violationCount++;
          }
        }
      }

      // Check for transition-all in public files
      if (line.match(/(?<![a-zA-Z0-9_\-:])transition-all\b/)) {
        console.log(`  ⚠️ [${relPath}:${idx + 1}] Found unoptimized transition-all in public file`);
        violationCount++;
      }
    });
  }

  if (violationCount === 0) {
    console.log("  ✓ No unadapted single-theme palette classes or transition-all found in public files! (0 violations)\n");
  } else {
    console.log(`\n  ⚠️ Total violations in public files: ${violationCount}\n`);
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
