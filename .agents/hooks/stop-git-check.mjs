#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function git(repoRoot, args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function main() {
  const raw = readStdin();
  let payload = {};
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      process.stdout.write("{}");
      return;
    }
  }

  // Allow stop cleanly on errors, cancels, limits, or after one reminder pass
  if (payload.terminationReason && payload.terminationReason !== "NO_TOOL_CALL") {
    process.stdout.write("{}");
    return;
  }
  if (Number(payload.executionNum || 1) > 1) {
    process.stdout.write("{}");
    return;
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const fallbackRoot = path.resolve(__dirname, "../..");
  const repoRoot =
    (Array.isArray(payload.workspacePaths) && payload.workspacePaths[0]) || fallbackRoot;

  try {
    const dirtyLines = git(repoRoot, ["status", "--porcelain", "--untracked-files=normal"])
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.endsWith(".DS_Store"));

    let aheadCount = 0;
    try {
      aheadCount = Number(git(repoRoot, ["rev-list", "--count", "@{u}..HEAD"])) || 0;
    } catch {
      aheadCount = 0;
    }

    if (dirtyLines.length === 0 && aheadCount === 0) {
      process.stdout.write("{}");
      return;
    }

    const details = [];
    if (dirtyLines.length > 0) details.push(`uncommitted files: ${dirtyLines.length}`);
    if (aheadCount > 0) details.push(`unpushed commits: ${aheadCount}`);

    process.stdout.write(
      JSON.stringify({
        decision: "continue",
        reason: `Git reminder (${details.join(", ")}). If you finished implementing code changes in this turn, run verification checks and automatically git commit + git push origin main. If this turn was only Q&A or planning before approval, state that clearly and finish without pushing.`,
      })
    );
  } catch {
    process.stdout.write("{}");
  }
}

main();
