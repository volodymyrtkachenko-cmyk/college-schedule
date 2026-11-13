const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadTsModule } = require("./helpers/load-ts-module.cjs");

function loadVisualStudio() {
  return loadTsModule(path.join(__dirname, "../lib/visualStudio.ts"));
}

function parseTuple(tupleStr) {
  const parts = String(tupleStr).trim().split(/\s+/).map(Number);
  assert.equal(parts.length, 3, `Expected 3 RGB channels in "${tupleStr}"`);
  return { r: parts[0], g: parts[1], b: parts[2] };
}

test("buildCustomAccentVars satisfies WCAG AA contrast across all 360 hues, both themes, and matte/oled surfaces", () => {
  const vs = loadVisualStudio();
  const themes = ["dark", "light"];
  const surfaces = ["matte", "oled"];
  const bgKeys = ["--sys-bg", "--sys-card", "--sys-surface", "--sys-elevated", "--sys-input", "--sys-tab-active"];
  const accentBgKeys = ["--sys-bg", "--sys-card", "--sys-surface", "--sys-elevated", "--sys-tab-active"];
  const white = { r: 255, g: 255, b: 255 };

  for (const resolvedTheme of themes) {
    for (const surface of surfaces) {
      for (let hue = 0; hue < 360; hue++) {
        const result = vs.buildCustomAccentVars(hue, 82, resolvedTheme, surface);
        const primary = parseTuple(result.vars["--sys-text-primary"]);
        const secondary = parseTuple(result.vars["--sys-text-secondary"]);
        const muted = parseTuple(result.vars["--sys-text-muted"]);
        const accent = parseTuple(result.vars["--sys-accent"]);
        const accentSolid = parseTuple(result.vars["--sys-accent-solid"]);

        for (const bgKey of bgKeys) {
          const bg = parseTuple(result.vars[bgKey]);
          assert.ok(
            vs.contrastRatio(primary, bg) >= 7.0,
            `${resolvedTheme}/${surface}/hue=${hue}: primary vs ${bgKey} < 7.0`
          );
          assert.ok(
            vs.contrastRatio(secondary, bg) >= 4.5,
            `${resolvedTheme}/${surface}/hue=${hue}: secondary vs ${bgKey} < 4.5`
          );
          assert.ok(
            vs.contrastRatio(muted, bg) >= 4.5,
            `${resolvedTheme}/${surface}/hue=${hue}: muted vs ${bgKey} < 4.5`
          );
        }

        for (const bgKey of accentBgKeys) {
          const bg = parseTuple(result.vars[bgKey]);
          assert.ok(
            vs.contrastRatio(accent, bg) >= 4.5,
            `${resolvedTheme}/${surface}/hue=${hue}: accent vs ${bgKey} < 4.5`
          );
        }

        assert.ok(
          vs.contrastRatio(white, accentSolid) >= 4.5,
          `${resolvedTheme}/${surface}/hue=${hue}: white vs --sys-accent-solid < 4.5`
        );
      }
    }
  }
});

test("encodeThemeShareCode and decodeThemeShareCode roundtrip stock, custom hue, and custom wallpaper fallback", () => {
  const vs = loadVisualStudio();

  const stockConfig = vs.sanitizeVisualConfig({
    surface: "glass",
    backdrop: "aurora",
    fontPreset: "tech",
    radius: "soft",
    density: "compact",
  });
  const stockEncoded = vs.encodeThemeShareCode("cyan", stockConfig);
  assert.equal(stockEncoded.droppedCustomWallpaper, false);
  assert.equal(stockEncoded.code, "DFKR1.glass.aurora.tech.soft.compact.cyan");

  const stockDecoded = vs.decodeThemeShareCode(`  ${stockEncoded.code}  `);
  assert.deepEqual(JSON.parse(JSON.stringify(stockDecoded)), {
    accent: "cyan",
    config: {
      surface: "glass",
      backdrop: "aurora",
      fontPreset: "tech",
      radius: "soft",
      density: "compact",
    },
  });

  const customConfig = vs.sanitizeVisualConfig({
    surface: "oled",
    backdrop: "blueprint",
    fontPreset: "sans",
    radius: "sharp",
    density: "relaxed",
    customHue: 284,
    customSaturation: 77,
  });
  const customEncoded = vs.encodeThemeShareCode("custom", customConfig);
  assert.equal(customEncoded.code, "DFKR1.oled.blueprint.sans.sharp.relaxed.c284s77");
  assert.deepEqual(JSON.parse(JSON.stringify(vs.decodeThemeShareCode(customEncoded.code))), {
    accent: "custom",
    config: {
      surface: "oled",
      backdrop: "blueprint",
      fontPreset: "sans",
      radius: "sharp",
      density: "relaxed",
      customHue: 284,
      customSaturation: 77,
    },
  });

  const photoEncoded = vs.encodeThemeShareCode("violet", {
    ...vs.DEFAULT_VISUAL_CONFIG,
    backdrop: "custom",
    surface: "glass",
  });
  assert.equal(photoEncoded.droppedCustomWallpaper, true);
  assert.equal(photoEncoded.code, "DFKR1.glass.aurora.sans.default.default.violet");

  assert.equal(vs.decodeThemeShareCode(""), null);
  assert.equal(vs.decodeThemeShareCode("DFKR2.matte.none.sans.default.default.blue"), null);
  assert.equal(vs.decodeThemeShareCode("DFKR1.glass.custom.tech.soft.default.blue"), null);
  assert.equal(vs.decodeThemeShareCode("DFKR1.matte.none.sans.default.default.c360s80"), null);
  assert.equal(vs.decodeThemeShareCode("DFKR1.matte.none.sans.default.default.c210s20"), null);
  assert.equal(vs.decodeThemeShareCode("DFKR1.invalid.none.sans.default.default.blue"), null);
});

test("sanitizeVisualConfig normalizes bounds/invalid fields and presets match themselves cleanly", () => {
  const vs = loadVisualStudio();

  const fromInvalid = vs.sanitizeVisualConfig(null);
  assert.deepEqual(fromInvalid, vs.DEFAULT_VISUAL_CONFIG);

  const clamped = vs.sanitizeVisualConfig({
    surface: "unknown",
    backdrop: "invalid",
    fontPreset: "mono-bad",
    radius: "ultra",
    density: "dense",
    customHue: -30,
    customSaturation: 120,
    wallpaperBlur: 50,
    wallpaperDim: -5,
    wallpaperTint: "not-a-hex",
  });

  assert.equal(clamped.surface, "matte");
  assert.equal(clamped.backdrop, "none");
  assert.equal(clamped.fontPreset, "sans");
  assert.equal(clamped.radius, "default");
  assert.equal(clamped.density, "default");
  assert.equal(clamped.customHue, 330);
  assert.equal(clamped.customSaturation, 100);
  assert.equal(clamped.wallpaperBlur, 24);
  assert.equal(clamped.wallpaperDim, 10);
  assert.equal(clamped.wallpaperTint, null);

  assert.equal(vs.CURATED_STYLE_PRESETS.length, 5);
  for (const preset of vs.CURATED_STYLE_PRESETS) {
    const merged = vs.sanitizeVisualConfig({
      ...vs.DEFAULT_VISUAL_CONFIG,
      ...preset.config,
    });
    assert.equal(
      vs.matchesCuratedPreset(preset, preset.accent, merged),
      true,
      `Preset ${preset.id} should match itself`
    );
  }
});
