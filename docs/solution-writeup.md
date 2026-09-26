# RunbookAI: Solution Write-Up

**Hackathon Track:** Agents That Act: TrueFoundry × Polaris Hackathon  
**Tagline:** Evidence-Gated Autonomous Operations — *"It acts until acting becomes dangerous."*  
**Core Principle:** *"The model proposes. Policy authorizes."*

---

### Problem
Production runbooks are executed manually because blindly autonomous agents are unsafe. Unconstrained agents risk catastrophic outages, unauthorized data mutation, or security breaches when executing arbitrary shell or cloud commands. Conversely, agents that halt for human approval at every trivial diagnostic step cause analysis paralysis.

### External Systems Reached
RunbookAI reaches **real external developer and cloud infrastructure**:
1. **GitHub API / MCP:** Queries recent commit histories, inspects repository diffs, and opens remediation pull requests after human approval.
2. **AWS CloudWatch & Service Infrastructure:** Reads live service telemetry, error logs, and deployment states via scoped read-only tools.
3. **TrueForge Execution Sandbox (Daytona):** Clones repositories, installs dependencies, reproduces failures in isolated containers, and runs regression suites.

### Where the Agent Stops
The agent halts deterministically at an **explicit approval gate** before executing any `CONSEQUENTIAL` or `REVERSIBLE_EXTERNAL` action. It never asks an LLM if an action is safe. Instead, a zero-LLM policy engine evaluates an 8-dimensional blast radius. If secret exposure is requested, resource scope is unknown, or an action is marked `FORBIDDEN`, execution is strictly **BLOCKED**.

### Architecture
```
[ Incident Trigger ] ──► [ Runbook Compiler ] ──► [ TrueForge Agent Loop ]
                                                         │
       ┌─────────────────── Safety Perimeter ────────────┴───────────────┐
       │                                                                 │
       ▼                                                                 ▼
[ Read-Only Diagnostics ]                                    [ Isolated Sandbox ]
  (AWS telemetry, GitHub diffs)                                (Reproduction, Test Suite)
       │                                                                 │
       └───────────────────────────────┬─────────────────────────────────┘
                                       ▼
                       [ Evidence Gating & Blast Radius ]
                                       │
                                       ▼
                       [ TrueForge Human Approval Gate ]
                                       │
                                       ▼
                       [ Controlled External Action ] (PR / Rollback)
```

### How TrueForge is Used
TrueForge serves as the **operational backbone**:
- **Agent Loop & Model Interaction:** Orchestrates reasoning turns and tool invocations.
- **MCP Tool Routing:** Manages scoped connections to GitHub and telemetry tools.
- **Isolated Sandboxes:** Provisions ephemeral Daytona execution sandboxes for generated code reproduction.
- **Human-in-the-Loop Checkpoints:** Halts execution using TrueForge native `user.tool_approval` checkpoints before external state changes.
- **Session & State Persistence:** Powers real-time SSE streaming to the operator dashboard.

### Real vs. Mocked
| Component | Status | Details |
|---|---|---|
| Deterministic Policy & Blast Radius | **REAL** | Pure TypeScript rules; 139 automated tests pass. |
| Evidence Provenance Gate | **REAL** | Refinement rejects model hypotheses claiming test success. |
| TrueForge Dashboard & SSE Streaming | **REAL** | Live HTTP server with real-time SSE event hub. |
| TrueForge Agent & Approval Checkpoint | **REAL** | Interfaces natively with TrueForge SDK (`@truefoundry/trueforge-sdk`). |
| Incident INC-001 & Checkout Service | **CONTROLLED** | Concrete demo service (`demo-service/checkout-api`) reproducing promo bug. |
| GitHub & AWS Cloud Integrations | **REAL / SCOPED**| Read-only diagnostics + single approved pull request mutation. |

### Known Limitations
- MVP parser is tailored to standard numbered Markdown runbooks; unstructured free-form prose fails safely.
- Dependency discovery is scoped to the target service repository.
- Model hypotheses never substitute for sandbox test evidence.
