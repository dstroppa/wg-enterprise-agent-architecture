/**
 * Embedded scenario driver.
 *
 * Runs inside the mcp-market-data process (same process, per the design
 * decision: the market-data feed is the only thing the driver touches, so no
 * IPC is needed). It reads seed/scenario-timeline.json and applies each event
 * to the MarketDataStore at its scheduled offset, making the "continuous market
 * moving" behaviour visible in a short demo.
 *
 * Logging goes to stderr so it never corrupts the MCP stdio transport on stdout.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { MarketDataStore, DemandTrend } from "./store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = resolve(__dirname, "..", "..", "..", "seed");

interface TimelineEvent {
  atSeconds: number;
  type:
    | "competitor_price_change"
    | "demand_signal"
    | "inventory_update"
    | "competitor_prices_bulk_update";
  phase?: string;
  sku?: string;
  competitor?: string;
  newPrice?: number;
  trend?: DemandTrend;
  magnitude?: number;
  reason?: string;
  onHandDelta?: number;
  source?: string;
  restoreBaseline?: boolean;
  demoBeat?: number;
}

interface Timeline {
  durationSeconds: number;
  events: TimelineEvent[];
}

function log(msg: string): void {
  process.stderr.write(`[scenario-driver] ${msg}\n`);
}

export interface ScenarioDriverOptions {
  /** Multiplier applied to each event's atSeconds. 1 = real time. */
  tickScale?: number;
  /** Restart the timeline from the top after it finishes. */
  loop?: boolean;
}

export class ScenarioDriver {
  private readonly timeline: Timeline;
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly options: Required<ScenarioDriverOptions>;
  private running = false;

  constructor(
    private readonly store: MarketDataStore,
    options: ScenarioDriverOptions = {},
  ) {
    this.options = {
      tickScale: options.tickScale ?? 1,
      loop: options.loop ?? false,
    };
    this.timeline = JSON.parse(
      readFileSync(resolve(SEED_DIR, "scenario-timeline.json"), "utf8"),
    ) as Timeline;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    log(
      `starting timeline: ${this.timeline.events.length} events over ` +
        `${this.timeline.durationSeconds}s (tickScale=${this.options.tickScale}, loop=${this.options.loop})`,
    );
    this.scheduleAll();
  }

  private scheduleAll(): void {
    for (const event of this.timeline.events) {
      const delayMs = event.atSeconds * 1000 * this.options.tickScale;
      const timer = setTimeout(() => this.apply(event), delayMs);
      this.timers.push(timer);
    }

    if (this.options.loop) {
      const loopMs = this.timeline.durationSeconds * 1000 * this.options.tickScale;
      const timer = setTimeout(() => {
        log("timeline complete; looping");
        this.timers.length = 0;
        this.scheduleAll();
      }, loopMs);
      this.timers.push(timer);
    }
  }

  private apply(event: TimelineEvent): void {
    const beat = event.demoBeat ? ` [demo beat ${event.demoBeat}]` : "";
    switch (event.type) {
      case "competitor_price_change": {
        if (event.sku && event.competitor && event.newPrice !== undefined) {
          const ok = this.store.setCompetitorPrice(
            event.sku,
            event.competitor,
            event.newPrice,
          );
          log(
            `${event.phase ?? ""}${beat} competitor ${event.competitor} on ${event.sku} -> $${event.newPrice} (${ok ? "applied" : "unknown SKU"})`,
          );
        }
        break;
      }
      case "demand_signal": {
        if (event.sku && event.trend && event.magnitude !== undefined) {
          const ok = this.store.setDemandSignal(
            event.sku,
            event.trend,
            event.magnitude,
            event.reason ?? "",
          );
          log(
            `${event.phase ?? ""}${beat} demand ${event.sku} -> ${event.trend} ${(event.magnitude * 100).toFixed(0)}% (${ok ? "applied" : "unknown SKU"})`,
          );
        }
        break;
      }
      case "inventory_update": {
        if (event.sku && event.onHandDelta !== undefined) {
          const ok = this.store.adjustInventory(event.sku, event.onHandDelta);
          log(
            `${event.phase ?? ""}${beat} inventory ${event.sku} delta ${event.onHandDelta} (${ok ? "applied" : "unknown SKU"})`,
          );
        }
        break;
      }
      case "competitor_prices_bulk_update": {
        if (!event.source) break;
        if (event.restoreBaseline) {
          const n = this.store.restoreCompetitorBaselineBySource(event.source);
          log(`${event.phase ?? ""}${beat} restored ${n} ${event.source} quotes to baseline`);
        } else if (event.newPrice !== undefined) {
          const n = this.store.bulkSetCompetitorPriceBySource(event.source, event.newPrice);
          log(
            `${event.phase ?? ""}${beat} GLITCH: set ${n} ${event.source} quotes -> $${event.newPrice}`,
          );
        }
        break;
      }
    }
  }

  stop(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.length = 0;
    this.running = false;
    log("stopped");
  }
}
