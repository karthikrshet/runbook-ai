# TrueForge integration boundary

RunbookAI has a deliberate boundary between its deterministic safety core and the TrueForge runtime.

## What RunbookAI decides locally

- whether an action is allowed, blocked, or needs approval;
- whether evidence is complete enough to request approval;
- the blast-radius facts and deterministic risk class;
- whether tool output is treated as evidence or untrusted content.

## What TrueForge must provide

A concrete integration, added only after the installed TrueForge documentation and types are inspected, must provide:

- the agent execution loop and model interaction;
- MCP tool routing to narrowly typed external tools;
- Daytona-backed sandbox execution for generated code;
- a native human approval checkpoint;
- session and execution state.

## Approval port

`HumanApprovalGateway` is a local TypeScript port. It accepts a complete `TrueForgeApprovalRequest` and returns a `TrueForgeApprovalResponse`. It intentionally does **not** contain endpoint URLs, SDK imports, credentials, shell commands, or a custom approval UI.

`evaluateApprovalGate` is fail-closed:

1. forbidden actions are blocked without contacting a gateway;
2. consequential actions require verified reproduction, verified passing checks, rollback availability, and no unresolved unknowns;
3. a missing or failed gateway yields `UNAVAILABLE`, never approval;
4. this component never executes the proposed external action.

The later concrete adapter must map this port to a real, visible TrueForge approval checkpoint. A frontend button or local mock is not a substitute.
