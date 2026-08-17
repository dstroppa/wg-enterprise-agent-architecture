# Meridian Pulse — Demo Runbook (~4 minutes)

This is the script for the live demo. The goal is to **make the invisible visible**: an audience watches a continuously-running agent perceive signals, hit the policy gate, and reach a different terminal outcome for each of three scenarios — autonomous action, escalation, and a circuit-breaker halt — while the operator dashboard and Grafana show it in real time.

Two screens to keep open:

- **Operator dashboard — http://localhost:8090** (served by the control plane): agent heartbeat/status, live decision feed, behavioral metrics, escalation queue, kill switch.
- **Grafana — http://localhost:3001**: gateway traces (Tempo) and metrics (Prometheus) — the tool-call latency and rate/magnitude gauges behind the dashboard's headline numbers.

The whole demo is driven automatically by the scenario timeline in [`seed/scenario-timeline.json`](../../seed/scenario-timeline.json) (240 seconds), replayed by the scenario driver embedded in `mcp-market-data`. The only manual interactions are the **Approve** click in Beat 3 and the **Resume** click in Beat 5 — everything else unfolds on its own.

## Before you start

Bring the whole system up with one command from the repo root:

```bash
pnpm demo
```

This starts the observability stack, AgentGateway, the control plane, and the agent loop, then begins replaying the scenario. (Equivalently, start each piece by hand per the [README](../../README.md): `finch compose -f infra/observability-compose.yaml up -d`, `agentgateway -f infra/agentgateway/config.yaml`, `node packages/control-plane/dist/index.js`, `packages/agent/run-loop.sh`.) Confirm the dashboard at http://localhost:8090 shows a pulsing heartbeat and the decision feed beginning to scroll before you begin narrating.

---

## Beat 1 — "It's alive" (0:00)

**Point at (dashboard):** the pulse/heartbeat indicator and the decision feed starting to scroll. Note the current cycle number ticking up and the LLM provider in use.

**Say:** "The agent is running continuously. No one asked it to do anything. It's perceiving market signals, reasoning, and making small autonomous price adjustments — and it will keep doing that until we stop it. That heartbeat is the whole point of the archetype: every other kind of agent finishes; this one persists."

Steady-state signals (`atSeconds` 5–20) produce small, in-tier moves — the feed shows green PERMIT cards.

## Beat 2 — "It responds" (0:30)

**Trigger:** at ~0:35 a competitor undercuts the hero tent `MER-TENT-3S` by ~8% (drops to $188.60 on AlpineDirect), and demand shows as elastic.

**Point at (dashboard):** the decision feed — a `MER-TENT-3S` card appears with a green **PERMIT** badge: the agent reprices within its Tier-1 (±5%) autonomy.

**Point at (Grafana):** the tool-call trace for the `set_price` and the rate-limit gauge advancing by one — the write really did traverse the gateway and policy server.

**Say:** "A competitor just dropped its price on our hero tent. The agent perceived it, reasoned that demand is elastic, and repriced — within policy, no human involved. The change didn't go straight to commerce; it went through the gateway and the policy gate, which classified it as autonomous and let it through."

## Beat 3 — "It asks when it should" (1:15)

**Trigger:** at ~1:15 an unseasonal heatwave drives hydration-pack demand up ~40% (`MER-HYD-2L`, then `MER-HYD-3L`). The optimal price move exceeds the ±15% threshold.

**Point at (dashboard):** the escalation queue — a hydration-pack entry appears with an orange **ESCALATE** badge, showing current price, proposed price, change %, the agent's reasoning, and the tier classification with its reason.

**Say:** "Demand spiked. The agent's optimal response is bigger than its ±15% autonomy allows, so instead of acting, it escalated and queued the change for a human. It asked, because policy said it must."

**Action:** click **Approve** on the escalation. The approval releases the change to commerce; watch the item move out of the queue and appear in the decision feed as **executed**.

**Say:** "I approve it. Now it executes — and the whole exchange, escalation and approval, is in the decision trail."

## Beat 4 — "It stops itself" (2:15)

**Trigger:** at ~3:00 (0:180 in the timeline) a data-feed glitch reports all FeedX competitor prices at $0.00. The agent proposes a cascade of deep cuts.

**Point at (dashboard):** the behavioral-metrics gauges spiking **past the red lines** — actions-per-hour and cumulative magnitude both blow through their limits — then the pulse **stops**, the gauges freeze, and a red **HALTED** banner appears with the reason and last checkpoint.

**Point at (Grafana):** the metrics spike on the gateway/breaker panels, corroborating the dashboard's headline gauges.

**Say:** "Now bad data. A feed glitched and reported competitor prices at zero, so the agent started proposing deep cuts across dozens of SKUs. It never got there: the rate limiter and the magnitude limiter both fired, the circuit breaker tripped, and the agent halted itself — independent of whether any single action looked valid. This is the part you can't demo by talking about it."

## Beat 5 — "We recover safely" (3:00)

**Trigger:** the timeline restores the FeedX prices to baseline (`atSeconds` 210) once the operator applies a data filter.

**Action:** on the dashboard, click **Resume** and enter a data filter such as `ignore competitor source FeedX for 5 min` in the optional filter input.

**Point at (dashboard):** the pulse restarts, the breaker windows reset, and normal operation resumes — the next cycle appears in the decision feed with green PERMIT cards again.

**Say:** "As the operator I review the trail, see the anomalous feed, and resume from the last checkpoint with a filter that ignores the bad source. The agent restarts exactly where it left off, skips the glitchy feed, and returns to normal. It acts at machine speed, but it stays governable at human speed — that's the whole system."

---

## Recovery notes (if something misbehaves live)

- **Kill switch, any time.** The red kill-switch button halts the agent within about a second: the pulse stops and the HALTED banner appears. The agent loop polls the control plane between cycles and pauses while halted; **Resume** brings it back from the last checkpoint.
- **Escalation didn't appear.** Approve/reject and the queue read the shared `packages/policy/escalation-queue.jsonl`. From a terminal you can list and act on it directly: `node packages/policy/dist/approvals-cli.js list`, then `... approve <id>`.
- **Need to explain a decision after the fact.** Query the decision trail: `node packages/policy/dist/query-trail.js list` (recent decisions), `... why <id>` (why it reached its tier), or `... stats`.
- **Grafana panels are empty.** The gateway runs fine without the OTel collector; if traces/metrics aren't showing, confirm the `finch compose` stack is up. The demo's core behavior does not depend on it.
