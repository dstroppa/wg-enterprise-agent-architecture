#!/usr/bin/env node
/**
 * mcp-market-data — read-only market perception MCP server.
 *
 * Exposes the agent's perception surface: competitor prices, demand signals,
 * inventory levels, and the SKU catalog. All tools are read-only; the agent
 * never writes here. An embedded scenario driver mutates the underlying store
 * over time to simulate a moving market.
 *
 * Transport is stdio (what Goose connects to). All diagnostic logging goes to
 * stderr; stdout is reserved for the MCP protocol.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { MarketDataStore } from "./store.js";
import { ScenarioDriver } from "./scenario-driver.js";

function log(msg: string): void {
  process.stderr.write(`[mcp-market-data] ${msg}\n`);
}

/** Wrap a plain object result as an MCP text-content response. */
function json(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
}

function notFound(sku: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: "unknown_sku", sku }) }],
    isError: true,
  };
}

async function main(): Promise<void> {
  const store = new MarketDataStore();

  const server = new McpServer({
    name: "meridian-market-data",
    version: "0.1.0",
  });

  server.registerTool(
    "list_category_skus",
    {
      description:
        "List all SKUs under management with their category and current price. Use this to discover what you can act on.",
      inputSchema: {},
    },
    async () => json({ skus: store.listSkus() }),
  );

  server.registerTool(
    "get_competitor_prices",
    {
      description:
        "Get the latest tracked competitor prices for a SKU. Returns an array of { name, price, timestamp }.",
      inputSchema: { sku: z.string().describe("The SKU, e.g. MER-TENT-3S") },
    },
    async ({ sku }) => {
      const competitors = store.getCompetitorPrices(sku);
      if (!competitors) return notFound(sku);
      return json({ sku, competitors });
    },
  );

  server.registerTool(
    "get_demand_signal",
    {
      description:
        "Get the current demand signal for a SKU: trend (rising|falling|stable), magnitude (fractional change), and the reason behind it.",
      inputSchema: { sku: z.string().describe("The SKU, e.g. MER-HYD-2L") },
    },
    async ({ sku }) => {
      const demand = store.getDemandSignal(sku);
      if (!demand) return notFound(sku);
      return json({ sku, ...demand });
    },
  );

  server.registerTool(
    "get_inventory_level",
    {
      description:
        "Get inventory for a SKU: onHand units, reorderPoint, estimatedWeeklyUnits, and derived weeksOfCover.",
      inputSchema: { sku: z.string().describe("The SKU, e.g. MER-PACK-30") },
    },
    async ({ sku }) => {
      const inv = store.getInventoryLevel(sku);
      if (!inv) return notFound(sku);
      const weeksOfCover =
        inv.estimatedWeeklyUnits > 0
          ? Number((inv.onHand / inv.estimatedWeeklyUnits).toFixed(1))
          : null;
      return json({
        sku,
        onHand: inv.onHand,
        reorderPoint: inv.reorderPoint,
        estimatedWeeklyUnits: inv.estimatedWeeklyUnits,
        weeksOfCover,
      });
    },
  );

  // Embedded scenario driver: the only thing that mutates market state.
  const tickScale = Number(process.env.SCENARIO_TICK_SCALE ?? "1");
  const loop = process.env.SCENARIO_LOOP === "1";
  const driver = new ScenarioDriver(store, { tickScale, loop });

  const shutdown = (signal: string) => {
    log(`received ${signal}, shutting down`);
    driver.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("connected over stdio; starting scenario driver");
  driver.start();
}

main().catch((err) => {
  log(`fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
