# RunbookAI: Architecture Specification

**Core Principle:** *"The model proposes. Policy authorizes."*

---

## 1. System Overview

```
                      [ PagerDuty / Incident Trigger ]
                                     │
                                     ▼
                     [ Runbook Compiler (Markdown) ]
                                     │
                                     ▼
                      [ TrueForge Agent Loop ]
             (Model Interaction · Session State · MCP Router)
                                     │
      ┌──────────────────────────────┴──────────────────────────────┐
      │                                                             │
      ▼                                                             ▼
[ MCP Tool Connectors ]                                   [ TrueForge Sandbox ]
- aws_get_health (Read-Only)                             - Clone demo repository
- aws_get_logs (Read-Only)                               - Install dependencies
- github_get_recent_commits (Read-Only)                  - Run repro.mjs
- github_create_pull_request (CONSEQUENTIAL)             - Run vitest test suite
      │                                                             │
      └──────────────────────────────┬──────────────────────────────┘
                                     ▼
                       [ Evidence Gating Engine ]
             (Zod Provenance Refinement: Blocks MODEL_HYPOTHESIS)
                                     │
                                     ▼
                     [ Blast Radius Risk Calculator ]
               (8 Dimensions: Precedence BLOCKED > HIGH > MED > LOW)
                                     │
                                     ▼
                     [ TrueForge Approval Checkpoint ]
                   (Halt session via user.tool_approval)
                                     │
                  ┌──────────────────┴──────────────────┐
                  ▼                                     ▼
            [ REJECTED ]                           [ APPROVED ]
            - Session finishes                     - Execute gated mutation
            - Audit logged                         - Verify /health endpoint
                                                   - Record final timeline
```

---

## 2. Package Structure & Responsibilities

### `@runbook-ai/core` (`packages/core`)
- **Domain Contracts:**
  - `action.ts`: ProposedAction model and 5 action categories (`READ_ONLY`, `SANDBOX_ONLY`, `REVERSIBLE_EXTERNAL`, `CONSEQUENTIAL`, `FORBIDDEN`).
  - `evidence.ts`: EvidencePackage, CheckResult, TestResult, and provenance typing.
  - `blast-radius.ts`: Deterministic risk calculator.
  - `incident.ts`: Incident entity and demo fixture `INC-001`.
  - `runbook.ts`: Runbook plan and step classification.
  - `tool-envelope.ts`: Standardized tool invocation envelopes.
- **Deterministic Policy:**
  - `permission-matrix.ts`: Policy rules mapping action classes to `ALLOW`, `REQUIRE_APPROVAL`, `BLOCK`.
  - `blast-radius.ts`: 8-dimensional blast radius evaluation.
- **Security:**
  - `untrusted-content.ts`: Adversarial instruction detector.
  - `redaction.ts`: Multi-pattern token and credential redactor.

### `@runbook-ai/dashboard` (`apps/dashboard`)
- **Operator Console:** React 19 + Vite dashboard for real-time visibility into the agent's progress, evidence package, blast radius, and decision controls.
- **Server:** Node.js HTTP server exposing SSE stream (`/api/sessions/:id/stream`), preflight checks, and TrueForge SDK client.
- **Data Sources:**
  - `TrueForgeSource`: Interfaces with a live TrueForge server (`@truefoundry/trueforge-sdk`).
  - `FixtureSource`: Synthetic replay of `INC-001` for reproducible local and offline demonstrations.

### `demo-service` (`demo-service/`)
- Concrete, runnable Node.js application (`checkout-api`) reproducing the release 1.4.0 promo code regression.
- Includes `/health` and `/checkout` endpoints plus unit and integration test suites.

---

## 3. Action Classification & Decision Matrix

| Category | Typical Tools | Policy Decision | Sandbox Required? | Human Approval Required? |
|---|---|---|---|---|
| `READ_ONLY` | `aws_get_health`, `aws_get_logs`, `github_get_recent_commits` | **`ALLOW`** | No | No |
| `SANDBOX_ONLY` | `exec` (sandbox runner, vitest, typecheck, npm install) | **`ALLOW`** | **Yes** | No |
| `REVERSIBLE_EXTERNAL` | `github_create_branch`, `aws_update_routing_flag` | **`REQUIRE_APPROVAL`** | No | **Yes** |
| `CONSEQUENTIAL` | `github_create_pull_request`, `aws_execute_rollback` | **`REQUIRE_APPROVAL`** | No | **Yes** |
| `FORBIDDEN` | Raw host shell, secret extraction, IAM deletion | **`BLOCK`** | N/A | **Rejected automatically** |

---

## 4. Blast Radius Precedence Rules

1. **`BLOCKED`** (Highest Precedence):
   - Action category is `FORBIDDEN`.
   - Action requests secret or credential exposure (`requestsSecretExposure === true`).
   - Action has unknown resource scope (`unknownScope === true`).
2. **`HIGH`**:
   - Action is marked destructive (`destructive === true`).
   - Mutation without available rollback (`mutatesExternalState && !rollbackAvailable`).
   - Affects more than 3 resources (`resourcesAffected > 3`).
3. **`MEDIUM`**:
   - Customer-facing external mutation with verified rollback.
   - Consequential or reversible external action with low resource footprint.
4. **`LOW`**:
   - Read-only queries.
   - Sandbox-only reproductions and test executions.
