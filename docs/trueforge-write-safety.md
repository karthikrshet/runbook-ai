# TrueForge dashboard write safety

The RunbookAI dashboard is read-only by default, including when it is connected to a live TrueForge server.

## Why this guard exists

The dashboard can eventually forward two consequential requests to TrueForge:

1. a human decision for a paused tool call;
2. a request to start a named agent run.

Those requests must not be enabled accidentally by a default environment value, a copied deployment configuration, or a fixture replay.

## Enabling a live write deliberately

Before any dashboard request can be forwarded, all of the following must be true:

```dotenv
DASHBOARD_SOURCE=trueforge
DASHBOARD_DECISIONS=on          # for approval/rejection forwarding
DASHBOARD_START_RUNS=on          # for starting a run
DASHBOARD_TRUEFORGE_WRITE_ACK=I_UNDERSTAND_TRUEFORGE_WRITES
```

Each feature flag is evaluated separately, so an operator can enable only the capability needed for a controlled demo. Fixture replay always has writes disabled.

## What this does not prove

This guard does not prove that a TrueForge API write succeeded, that a native approval checkpoint exists, or that an external action was executed. Those claims require captured output from the configured TrueForge runtime and its sandbox/MCP tools.
