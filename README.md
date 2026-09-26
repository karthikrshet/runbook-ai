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

# Run type check
npm run typecheck

# Run test suite
npm run test

# Run linter
npm run lint

# Build project
npm run build

# Start local dev
npm run dev
```

## Testing

Comprehensive test suites in `tests/`:
- `tests/action.test.ts` - Category validation, bounds checks, schema enforcement
- `tests/policy.test.ts` - Deterministic policy decisions and block overrides
- `tests/blast-radius.test.ts` - Precedence rules and risk classification
- `tests/evidence.test.ts` - Provenance gating and execution verification
- `tests/runbook.test.ts` - Markdown parsing, step ordering, safe failure
- `tests/security.test.ts` - Pattern detection and defensive redaction
- `tests/audit.test.ts` - Event schema, monotonic ordering, and payload sanitization

## Current Integration Status

| Component | Status | Notes |
|---|---|---|
| Local TypeScript core | REAL | Verified, compiles in strict mode |
| Deterministic policy | REAL | Unit tested, 100% deterministic |
| Evidence model | REAL | Typed provenance gating implemented |
| Blast radius | REAL | Deterministic calculator with precedence |
| Security primitives | REAL | Untrusted content analysis & redaction verified |
| Audit timeline | REAL | Chronologically validated, auto-redacted |
| Controlled Runbook | REAL | `checkout-incident.md` parsed and tested |
| TrueForge model | NOT VERIFIED | Boundary interfaces defined; live connection pending |
| Daytona provisioning | NOT VERIFIED | Environment provisioning pending |
| TrueForge sandbox execution | BLOCKED | Shell execution issue in external sandbox |
| Generated code sandbox execution | BLOCKED | Awaiting sandbox resolution |
| GitHub MCP | NOT STARTED | Tool boundary defined; integration pending |
| TrueForge native approval | NOT STARTED | Boundary interface defined; native flow pending |
| AWS integration | NOT STARTED | Planned for Phase P2 |
| Incident INC-001 | CONTROLLED | Controlled demo scenario fixture |

## Real vs Mocked

| Item | State | Description |
|---|---|---|
| Policy Engine | REAL | Deterministic TypeScript logic, zero mocks |
| Blast Radius | REAL | Computed from concrete action metadata |
| Evidence Schema | REAL | Strict Zod validation with refinement |
| Runbook Parser | REAL | Compiles markdown into typed steps |
| Security Filters | REAL | Active pattern matching & token redaction |
| Sandbox Execution | NOT TESTED LOCALLY | Local execution is NOT sandbox execution |
| External Human Approval | NOT CONNECTED | TrueForge native approval flow pending |
| Cloud Services (AWS/GH) | NOT CONNECTED | External calls remain unexecuted |

## AI Assistants Used

- **Google Antigravity (Advanced Agentic Coding):** Used for codebase inspection, TypeScript domain modeling, policy engine implementation, test creation, and quality gate verification.

## Known Limitations

- Runbook compiler currently targets controlled runbook formats; arbitrary free-form markdown is rejected safely.
- Sandbox execution is currently marked `BLOCKED` until TrueForge sandbox shell execution is resolved.
- Host execution is strictly prevented from substituting for sandbox execution.

## License

MIT License. Copyright (c) 2026 RunbookAI Contributors.
