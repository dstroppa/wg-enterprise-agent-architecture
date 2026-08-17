#!/usr/bin/env node
/**
 * Presenter helper for MANUAL demo mode.
 *
 * mcp-market-data owns its own stdio (the MCP transport), so "press Enter to
 * advance a beat" can't live inside that process. This little script is the
 * terminal-Enter surface: each time you press Enter it POSTs /scenario/next to
 * the market-data control port and prints what fired. It is just a friendly
 * wrapper around:  curl -X POST http://127.0.0.1:8091/scenario/next
 *
 * Usage (with `pnpm demo` running in MANUAL mode in another pane):
 *   node scripts/scenario-step.mjs           # or: pnpm scenario:step
 *   SCENARIO_CONTROL_PORT=8091 node scripts/scenario-step.mjs
 *
 * Press Enter to advance one beat; Ctrl-C (or Enter after the last beat) exits.
 */

import { createInterface } from "node:readline";

const PORT = Number(process.env.SCENARIO_CONTROL_PORT ?? "8091");
const BASE = `http://127.0.0.1:${PORT}`;

async function status() {
  try {
    const res = await fetch(`${BASE}/scenario/status`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function step() {
  const res = await fetch(`${BASE}/scenario/next`, { method: "POST" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function describe(result) {
  if (result.done && result.beat === null) return "Nothing left to advance — the timeline is complete.";
  const head = `Beat ${result.beat}${result.phase ? ` (${result.phase})` : ""} — ${result.applied.length} event(s):`;
  const body = result.applied.map((line) => `    • ${line}`).join("\n");
  const tail = result.done
    ? "\n  That was the last beat."
    : `\n  ${result.remaining} beat(s) remaining. Press Enter for the next.`;
  return `${head}\n${body}${tail}`;
}

const plan = await status();
if (!plan) {
  console.error(
    `Could not reach the scenario control surface at ${BASE}.\n` +
      `Is the demo running in MANUAL mode? Start it with:  SCENARIO_MODE=manual pnpm demo`,
  );
  process.exit(1);
}

console.log(
  `Manual scenario stepper — ${plan.beats.length} beats:\n` +
    plan.beats
      .map((b) => `  beat ${b.beat}${b.phase ? ` (${b.phase})` : ""}: ${b.eventCount} event(s)`)
      .join("\n") +
    `\n\nPress Enter to advance one beat. Ctrl-C to quit.\n`,
);

const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "» press Enter to advance ▸ " });
rl.prompt();
rl.on("line", async () => {
  try {
    const result = await step();
    console.log(describe(result));
    if (result.done) {
      rl.close();
      return;
    }
  } catch (err) {
    console.error(`step failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  rl.prompt();
});
rl.on("close", () => {
  console.log("\nStepper closed.");
  process.exit(0);
});
