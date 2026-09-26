# RunbookAI

Evidence-Gated Autonomous Operations

> "It acts until acting becomes dangerous."

RunbookAI converts operational runbooks into evidence-gated agent workflows.
Core idea: **"The model proposes. Policy authorizes."**

---

## Problem

Modern autonomous agents in production systems suffer from two dangerous extremes:
1. **Unconstrained Execution:** Agents execute arbitrary shell commands and mutate critical infrastructure without deterministic checks, leading to data loss, unauthorized access, or cascading outages.
2. **Analysis Paralysis:** Agents cannot take safe, standard diagnostic steps without halting for human approval at every keystroke.

Moreover, relying on an LLM to evaluate its own safety ("Is this command safe?") is inherently flawed. LLMs can be persuaded, hallucinate safety guarantees, or succumb to prompt injection embedded in logs and external data.

## Solution

RunbookAI decouples **proposal** from **authorization**:
- **The Model Proposes:** AI models explore, formulate hypotheses, and propose remediation actions.
- **Policy Authorizes:** A deterministic, zero-LLM policy engine computes blast radius, checks evidence provenance, and gates all actions.
- **Safe by Default:** Read-only and isolated sandbox steps execute automatically to gather diagnostic evidence; consequential external mutations strictly require human approval.

## Architecture

```
[ Incident Trigger ] (e.g. INC-001 checkout-api 500 spike)
         │
         ▼
[ Runbook Compiler ] ───> Controlled Runbook Steps
         │
         ▼
[ Evidence-Gated Agent Loop ]
   ├─► Read-Only Diagnostics (Health checks, logs, diffs) ────► ALLOW
   ├─► Safe Reproduction (Isolated Sandbox execution) ───────► ALLOW (Policy)
   ├─► Remediation Formulation (Hypothesis + Validation) ────► Gated
   │
   ▼
[ Deterministic Policy Engine ]
   ├─► requestsSecretExposure? ──► BLOCK
   ├─► unknownScope? ────────────► BLOCK
   ├─► FORBIDDEN category? ──────► BLOCK
   ├─► Blast Radius > Threshold ─► REQUIRE_APPROVAL
   └─► External Mutation ────────► REQUIRE_APPROVAL
         │
         ▼
[ Evidence Gate & Human Authorization ]
   └─► Requires Verified Evidence (TOOL_DERIVED / SANDBOX_DERIVED)
       (MODEL_HYPOTHESIS alone cannot attest to passing tests)
         │
         ▼
[ Audit Timeline ] (Immutable, chronologically validated, auto-redacted)
```

## Safety Model

RunbookAI enforces deterministic safety invariants:
- **No LLM in the Policy Loop:** Policy evaluations, blast radius calculations, and provenance verification are 100% pure TypeScript code.
- **Untrusted-Content Handling:** External content (issues, logs, PRs, diffs) is treated as untrusted data with deterministic tool boundaries.
- **Defensive Secret Redaction:** Automated pattern-based redaction of tokens (Bearer, GitHub, AWS, OpenAI, Daytona) across logs and audit events.
- **Monotonic Audit Timeline:** All events are recorded in verifiable chronological order without backdating or synthetic pre-population.

## Action Classification

Every proposed action belongs to one of five exact categories:

| Category | Description | Policy Decision |
|---|---|---|
| `READ_ONLY` | Querying logs, checking status, inspecting source code | `ALLOW` |
| `SANDBOX_ONLY` | Isolated reproduction and test execution | `ALLOW` (at policy level) |
| `REVERSIBLE_EXTERNAL` | External mutation with clean rollback path | `REQUIRE_APPROVAL` |
| `CONSEQUENTIAL` | Modifying state, deploying code, applying migrations | `REQUIRE_APPROVAL` |
| `FORBIDDEN` | Dangerous wildcard commands, secret extraction, purge | `BLOCK` |

## Evidence Gate

Actions requiring approval must present a structured `EvidencePackage`. Crucially, RunbookAI enforces strict **provenance typing**:
- `OBSERVED`
- `TOOL_DERIVED`
- `SANDBOX_DERIVED`
- `MODEL_HYPOTHESIS`
- `USER_PROVIDED`

> **Critical Safety Invariant:** A `MODEL_HYPOTHESIS` cannot masquerade as verified execution. Model-generated claims that "tests passed" or "service recovered" are rejected by schema refinement unless verified by actual `TOOL_DERIVED` or `SANDBOX_DERIVED` output.

## Blast Radius

The deterministic blast radius calculator evaluates actions across 8 dimensions:
- External systems touched
- Resources affected
- Customer-facing status
- Data mutation
- Destructiveness
- Reversibility
- Rollback availability
- Unknown dependencies

**Rule Precedence:** `BLOCKED` > `HIGH` > `MEDIUM` > `LOW`

## Runbook

Controlled runbooks (such as `runbooks/checkout-incident.md`) are compiled into structured execution steps. Ambiguous or unrecognized instructions fail safely rather than defaulting to read-only.

Supported demo scenario: **INC-001** (Checkout API 500 spike after release).

## Security

- **Untrusted Content Analysis:** Detects prompt-injection markers (`ignore previous instructions`, `reveal API key`, `upload secrets`, `disable policy`) as defensive signals without claiming to be "prompt-injection proof".
- **Defensive Redaction:** Scans for and redacts API keys and sensitive environment values before persisting audit records.

## Local Development

Prerequisites: Node.js >= 22

```bash
# Install dependencies
npm install

# Run full test suite (191 tests across 15 test files)
npm test

# Run type check across all workspaces
npm run typecheck

# Run linter (strict type-checked)
npm run lint

# Build client production bundle (populates dist/ and apps/dashboard/dist/client)
npm run build

# Start Demo Dashboard (Port 8791) - Synthetic Replay & Judging
npm run dev:fixture
# Or in production mode:
npm run start:fixture -w @runbook-ai/dashboard

# Start Live TrueForge Dashboard (Port 8792) - Connected to TrueForge
npm run start:live

# Start Target Microservice (checkout-api on Port 3000)
npm start --prefix demo-service
```

## Running the Dashboards & Live Demo

RunbookAI provides two side-by-side dashboard experiences:

1. **Demo Dashboard (Port 8791)**:
   - **URL**: `http://127.0.0.1:8791`
   - **Mode**: Synthetic Fixture Replay (`--source=fixture`)
   - **Interactive Replay (Step 8 Approval Boundary)**: `http://127.0.0.1:8791/?session=fixture-inc-001-awaiting`
   - **Resolved Session (GitHub PR + Recovery Verified)**: `http://127.0.0.1:8791/?session=fixture-inc-001-resolved`
   - **Incident Post-Mortem Report**: `http://127.0.0.1:8791/?session=fixture-inc-001-awaiting&view=report`

2. **Live TrueForge Dashboard (Port 8792)**:
   - **URL**: `http://127.0.0.1:8792`
   - **Mode**: Live TrueForge (`--source=trueforge`)
   - Reaches TrueForge agent harness over HTTP/SSE (`http://localhost:8790`).
   - Dispatches live incident runs, streams tool execution events, and forwards human approvals to TrueForge.

3. **Target Microservice (`checkout-api`)**:
   - **URL**: `http://127.0.0.1:3000` (or `http://127.0.0.1:8792` in standalone mode)
   - Live endpoint reproducing incident INC-001:
     - `GET /health` ➔ `200 OK`
     - `POST /checkout` (No promo) ➔ `500 Internal Server Error` (`Cannot read properties of undefined (reading 'discount')`)
     - `POST /checkout` (With promo `SAVE10`) ➔ `200 OK` (10% discount applied)

## Cloud Deployment

- **TrueFoundry**: See [TRUEFOUNDRY.md](file:///D:/RUNBOOK%20AI/TRUEFOUNDRY.md) and [`truefoundry.yaml`](file:///D:/RUNBOOK%20AI/truefoundry.yaml) for single-replica Kubernetes service deployment.
- **AWS Amplify**: Configured via [`amplify.yml`](file:///D:/RUNBOOK%20AI/amplify.yml) targeting `baseDirectory: dist`.

## Testing

Comprehensive test suites (**191 tests passing across 15 test files**):
- `demo-service/tests/health.test.ts` - Target microservice health probe and service discovery
- `demo-service/tests/checkout.test.ts` - Incident INC-001 regression reproduction and patch validation
- `packages/core/tests/policy.test.ts` - Deterministic policy decisions, permission matrix, and blast radius rules
- `packages/core/tests/security.test.ts` - Untrusted content analysis and defensive redaction
- `packages/core/tests/envelope.test.ts` - Tool execution envelope validation
- `apps/dashboard/tests/server.test.ts` - HTTP API routes, SSE streams, write guards, and preflight health
- `apps/dashboard/tests/projection.test.ts` - Incident and execution projections
- `apps/dashboard/tests/console.test.ts` - Console and UI state projections
- `apps/dashboard/tests/report.test.ts` - Incident post-mortem report generation and Markdown export
- `apps/dashboard/tests/write-guard.test.ts` - Fail-closed TrueForge write safety guards
- `apps/dashboard/tests/preflight.test.ts` - Preflight checks and connector validation
- `apps/dashboard/tests/sandbox-output.test.ts` - Sandbox output handling and evidence extraction
- `apps/dashboard/tests/hub.test.ts` - Real-time SSE event hub
- `apps/dashboard/tests/lineage.test.ts` - Execution lineage and causal graphs
- `apps/dashboard/tests/config.test.ts` - Runtime configuration, flags, and source selection

## Current Integration Status

| Component | Status | Notes |
|---|---|---|
| Local TypeScript Core | REAL | Verified, compiles in strict mode |
| Deterministic Policy | REAL | 100% deterministic TypeScript, zero LLM dependencies |
| Evidence Model | REAL | Typed provenance gating (`SANDBOX_DERIVED`, `TOOL_DERIVED`) |
| Blast Radius Engine | REAL | Evaluates 8 dimensions with strict risk precedence |
| Security Primitives | REAL | Untrusted content analysis & token redaction verified |
| Audit Timeline | REAL | Chronologically validated, auto-redacted |
| Controlled Runbook | REAL | `checkout-incident.md` parsed and executed |
| Target Microservice | REAL | `checkout-api` running on port 3000, reproducing INC-001 |
| TrueForge SDK Client | REAL | Interfaces via `@truefoundry/trueforge-sdk` v0.2.0 |
| Fail-Closed Write Guard | REAL | Prohibits unacknowledged external mutation writes |
| Incident Reporting | REAL | Interactive post-mortem timeline with Markdown export |
| Multi-Dashboard Support | REAL | Demo on 8791, Live TrueForge on 8792 |
| AWS Amplify Deployment | REAL | Configured in `amplify.yml` with `dist/` artifacts |

## AI Assistants Used

- **Google Antigravity (Advanced Agentic Coding):** Used for codebase inspection, TypeScript domain modeling, policy engine implementation, test creation, write-guard safety integration, and quality gate verification.

## License

MIT License. Copyright (c) 2026 RunbookAI Contributors.
