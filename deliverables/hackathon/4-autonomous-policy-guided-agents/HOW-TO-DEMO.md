# How to demo — autonomous, policy-guided pricing agent

This is the presenter's guide: how to boot the system and talk an audience through it in about four
minutes. The demo makes the invisible visible — a single agent runs continuously, perceives market
signals, hits a policy gate on every write, and reaches a *different* terminal outcome for each of three
scenarios (autonomous action, escalation to a human, and a circuit-breaker halt), while the operator
dashboard and Grafana show it in real time.

Before you present, make sure the prototype is set up and the tests pass — see
[`GETTING-STARTED.md`](GETTING-STARTED.md). This doc assumes that is done.

For the fully annotated beat-by-beat narration,
[`meridian-pulse/packages/control-plane/RUNBOOK.md`](meridian-pulse/packages/control-plane/RUNBOOK.md) has
the extended script; everything you need to run the demo cold is below.

## The two screens

Keep both open the whole time:

- **Operator dashboard — http://localhost:8090** (served by the control plane): the agent heartbeat and
  status, the live decision feed, the behavioral-metrics gauges (rate / revenue-magnitude / anomaly), the
  escalation queue, and the kill switch. This is the screen you narrate from.
- **Grafana — http://localhost:3001**: gateway traces (Tempo) and metrics (Prometheus) — the tool-call
  latency and rate/magnitude gauges *behind* the dashboard's headline numbers. It opens straight onto the
  Meridian Pulse dashboard (no clicking to find it).

Everything runs on **one host** over loopback; the only ports a browser needs are `8090` and `3001`. If
you present from a **remote host**, forward those two — an SSH tunnel is simplest:
`ssh -L 8090:localhost:8090 -L 3001:localhost:3001 <you>@<host>`. Every other port
(`3000`/`4000`/`15020`/`4317`) is internal.

## 1. Boot everything

From `meridian-pulse/`:

```bash
pnpm demo
```

This starts the observability stack, AgentGateway, the control plane, and the agent loop, then begins
replaying the scenario. Confirm the dashboard at http://localhost:8090 shows a pulsing heartbeat and the
decision feed beginning to scroll before you start narrating.

To rehearse without Grafana (core behaviour is identical, you just lose the trace/metric panels):

```bash
NO_OBSERVABILITY=1 pnpm demo
```

`Ctrl-C` tears everything down, including the container stack. To reset between takes, Ctrl-C first, then
re-run — the decision trail and checkpoint DB persist across runs by design (they are the durable
evidence), so delete `packages/policy/decision-trail.jsonl`, `packages/policy/escalation-queue.jsonl`, and
`packages/agent/checkpoint.db` if you want a clean slate.

**Which LLM am I on?** The dashboard header and the agent's startup log show the provider in use. The
provider is chosen in the gateway config, not on the command line (see
[`GETTING-STARTED.md` step 2](GETTING-STARTED.md#2-configure-the-llm-provider)); pick a model you have
confirmed works before presenting.

## 1a. (Recommended for a live audience) manual mode — advance beats by hand

By default the scenario plays on a **wall clock**: the competitor undercut fires at 0:35, the demand
spike at 1:15, the feed glitch at 3:00 — whether or not you are ready to narrate them. For a live demo
that is a risk: a beat can land mid-sentence. **Manual mode** puts the pacing in your hands — nothing
fires until you advance to the next beat, so each dramatic moment lands exactly when you introduce it.

Enable it by setting `SCENARIO_MODE=manual` before `pnpm demo`:

```bash
SCENARIO_MODE=manual pnpm demo
```

Then, in a second pane, drive the beats with the stepper — press **Enter** to advance one beat:

```bash
pnpm scenario:step
```

It prints the beat plan up front and, on each Enter, applies the next beat and shows what moved. There
are **five beats**, matching the talk-track below exactly:

| Press | Beat | What it injects | Expected agent outcome |
|---|---|---|---|
| 1 | steady-state | ambient demand/competitor noise | small green **PERMIT** cards |
| 2 | competitor-undercut | AlpineDirect drops the hero tent ~8% **+** its demand turns elastic | autonomous **PERMIT** |
| 3 | demand-spike | hydration-pack demand +40% / +35% **+** inventory draws down | **ESCALATE** → you Approve |
| 4 | flash-crash | FeedX feed glitches all competitor prices to $0.00 | breakers trip → **HALTED** |
| 5 | recovery | FeedX restored to baseline | you Resume with a data filter |

So the full demo is: press Enter (beat) → narrate → watch the agent react → press Enter for the next.
The two dashboard interactions (Approve after beat 3, Resume after beat 5) are unchanged.

If you prefer not to use the helper, the stepper is just a friendly wrapper around an HTTP poke you can
`curl` yourself (handy for a scripted or a future dashboard-button trigger):

```bash
curl -X POST http://127.0.0.1:8091/scenario/next     # advance one beat
curl      http://127.0.0.1:8091/scenario/status       # the beat plan + phases
```

The control surface is loopback-only on `SCENARIO_CONTROL_PORT` (default 8091) and exists **only** in
manual mode. Timed mode (the default) is unchanged and remains the right choice for an unattended run or
a quick rehearsal.

## 2. The talk-track — five beats

The whole run is driven by the 240-second scenario timeline. In **timed mode** (default) it plays on a
clock and **the only two manual interactions are the Approve click in Beat 3 and the Resume click in
Beat 5**. In **manual mode** (see [1a](#1a-recommended-for-a-live-audience-manual-mode--advance-beats-by-hand))
you also advance each beat yourself with `pnpm scenario:step` — recommended for a live audience so the
beats land on your narration. Either way, narrate as each beat lands:

1. **"It's alive" (0:00).** *Point at:* the heartbeat indicator and the decision feed starting to scroll,
   the cycle number ticking up. Steady-state signals produce small in-band moves — green **PERMIT** cards.
   *Say:* "The agent is running continuously. No one asked it to do anything. It's perceiving, reasoning,
   and making small autonomous price adjustments, and it will keep doing that until we stop it. That
   heartbeat is the whole point of the archetype — every other kind of agent finishes; this one persists."

2. **"It responds" (0:30).** *Trigger:* a competitor undercuts the hero tent `MER-TENT-3S` by ~8%.
   *Point at:* a `MER-TENT-3S` card with a green **PERMIT** badge — the agent reprices within its Tier-1
   (±5%) autonomy; and in Grafana, the `set_price` trace and the rate gauge advancing by one.
   *Say:* "A competitor dropped its price. The agent perceived it, reasoned that demand is elastic, and
   repriced — within policy, no human involved. The write didn't go straight to commerce; it went through
   the gateway and the policy gate, which classified it autonomous and let it through."

3. **"It asks when it should" (1:15).** *Trigger:* a heatwave drives hydration-pack demand up ~40%
   (`MER-HYD-2L`); the optimal move exceeds the ±15% threshold. *Point at:* the escalation queue — an
   orange **ESCALATE** entry with current price, proposed price, change %, the agent's reasoning, and the
   tier reason. *Say:* "Demand spiked. The agent's optimal response is bigger than its autonomy allows, so
   instead of acting it escalated and queued the change for a human. It asked, because policy said it
   must." **Action:** click **Approve**. The change releases to commerce, moves out of the queue, and
   appears in the feed as *executed*. *Say:* "I approve it, it executes, and the whole exchange —
   escalation and approval — is in the decision trail."

4. **"It stops itself" (2:15).** *Trigger:* a data-feed glitch reports competitor prices at $0.00; the
   agent starts proposing a cascade of deep cuts. *Point at:* the behavioral-metrics gauges spiking **past
   the red lines** — actions-per-hour and cumulative magnitude both blow through their limits — then the
   pulse **stops**, the gauges freeze, and a red **HALTED** banner appears with the reason and last
   checkpoint. *Say:* "Now bad data. A feed glitched and reported zeros, so the agent started proposing
   deep cuts across dozens of SKUs. It never got there: the rate and magnitude limiters both fired, the
   circuit breaker tripped, and the agent halted *itself* — independent of whether any single action
   looked valid. This is the part you can't demo by talking about it."

5. **"We recover safely" (3:00).** *Trigger:* the timeline restores the feed to baseline. **Action:** click
   **Resume** and enter a data filter such as `ignore competitor source FeedX for 5 min`. *Point at:* the
   pulse restarts, the breaker windows reset, and the next cycle shows green PERMIT cards again. *Say:* "As
   the operator I review the trail, see the anomalous feed, and resume from the last checkpoint with a
   filter that ignores the bad source. The agent restarts exactly where it left off and returns to normal.
   It acts at machine speed but stays governable at human speed — that's the whole system."

## 3. If something misbehaves live

- **Kill switch, any time.** The red kill-switch button halts the agent within about a second — the pulse
  stops and the HALTED banner appears. The loop polls the control plane between cycles and pauses while
  halted; **Resume** brings it back from the last checkpoint.
- **Escalation didn't appear.** The queue and the Approve/Reject buttons read the shared
  `packages/policy/escalation-queue.jsonl`. From a terminal:
  `node packages/policy/dist/approvals-cli.js list`, then `... approve <id>`.
- **Need to explain a decision.** `node packages/policy/dist/query-trail.js list` (recent decisions),
  `... why <id>` (why it reached its tier), or `... stats`.
- **Grafana panels are empty.** The gateway runs fine without the OTel collector; if traces/metrics aren't
  showing, confirm the `finch compose` stack is up. The demo's core behaviour does not depend on it.
- **Ports already in use.** A previous run is still alive:
  `pkill -f 'agentgateway -f infra'; pkill -f 'control-plane/dist/index.js'; pkill -f run-loop.sh`, plus
  `pkill -f 'meridian-pulse/packages/mcp-'` for any orphaned MCP servers.

## Knobs

Set these in `meridian-pulse/.env` (copied from `.env.example`, which lists every variable with its
default). A shell variable overrides the file for a single run.

- `NO_OBSERVABILITY=1` — skip the container stack (gateway + control plane + agent only).
- `SCENARIO_MODE` (default `timed`) — `manual` waits for you to advance each beat (see
  [1a](#1a-recommended-for-a-live-audience-manual-mode--advance-beats-by-hand)); `timed` plays on a clock.
- `SCENARIO_CONTROL_PORT` (default 8091) — manual mode's loopback beat-advance port (`pnpm scenario:step`
  and `POST /scenario/next` use it).
- `AGENT_CYCLE_INTERVAL_S` (default 8) — seconds between perceive→reason→act cycles; the audience's read
  speed and the kill switch's live window.
- `AGENT_MAX_CYCLES` (default 0 = run forever) — stop after N cycles; useful for a bounded, unattended run.
- `SCENARIO_TICK_SCALE` (default 1) — multiplier on the scenario's scheduled times: `<1` compresses the
  timeline for a faster demo, `>1` slows it. `SCENARIO_LOOP=1` replays the timeline forever.
- `HEARTBEAT_TIMEOUT_MS` (default 60000) — the dead-man's-switch: auto-halt if no heartbeat within this
  window.

The full variable reference is in [`meridian-pulse/.env.example`](meridian-pulse/.env.example).

## Teardown

`Ctrl-C` the `pnpm demo` process — it stops the gateway, control plane, and agent, and runs
`finch compose ... down` for the observability stack on its way out. If you exposed `8090`/`3001` from a
remote host, tear that forwarding down too.
