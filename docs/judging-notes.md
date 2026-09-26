# RunbookAI: Top-7 Presentation Script & Q&A Defense

**Format:** 8-Minute Live Presentation + 4-Minute Technical Q&A  
**Audience:** Hackathon Judges, SREs, Platform Engineers, and TrueFoundry Architects

---

## 8-Minute Presentation Timing

### 0:00 – 0:45: The Problem
> "Good afternoon. When an on-call SRE gets paged at 2 AM, the first thing they open is an incident runbook. The initial 5 to 10 steps are always the same: check health, query CloudWatch, diff the deployment, and pull recent commits. It's repetitive, manual, and exhausting. 
> 
> Naturally, teams try to hand this to autonomous LLM agents. But blind autonomy is dangerous. If you give an LLM agent write access to your cloud or repository, it will eventually hallucinate a dangerous shell command, exfiltrate credentials embedded in logs, or drop a database table. Today, agents either have too much power or are paralyzed by constant approval prompts."

### 0:45 – 1:30: The Solution
> "We built **RunbookAI: Evidence-Gated Autonomous Operations**. 
> Our tagline is simple: *'It acts until acting becomes dangerous.'*
> 
> Our core technical principle is: **The model proposes. Policy authorizes.**
> The LLM is never the judge of whether an action is safe. RunbookAI allows the agent to autonomously execute read-only diagnostics and isolated sandbox tests to gather concrete evidence. But the moment an action touches external state or exceeds a deterministic blast radius, the agent is halted at an explicit human approval checkpoint."

### 1:30 – 2:15: Architecture
> "Here is our architecture:
> 1. A human-readable Markdown runbook is compiled into typed steps categorized into `READ_ONLY`, `SANDBOX_ONLY`, `REVERSIBLE_EXTERNAL`, and `CONSEQUENTIAL`.
> 2. TrueForge drives the operational execution loop and routes tool requests over MCP.
> 3. Generated reproduction scripts and remediation code execute strictly inside TrueForge's isolated Daytona sandbox containers.
> 4. Diagnostic results are assembled into an `EvidencePackage`. Crucially, our schema uses typed provenance: a `MODEL_HYPOTHESIS` is forbidden from masquerading as verified execution.
> 5. If an action mutates external systems, a zero-LLM blast radius calculator computes risk, and TrueForge triggers a native human approval checkpoint."

### 2:15 – 6:00: Live Demo
> *(Walk through live demo on screen)*
> - **Trigger:** Ingest `INC-001` (checkout-api 500 spike after release 1.4.0).
> - **Diagnostics:** Agent reads CloudWatch logs and GitHub commits. Points to commit `9f3c2ab` (unhandled promo code).
> - **Sandbox Execution:** Agent writes reproduction script in Daytona sandbox. Running it reproduces the 500.
> - **Self-Correction:** Agent generates fix attempt 1. Vitest runs in sandbox: 1 test fails! Agent reads stderr, updates fix attempt 2, and all 12 tests pass.
> - **Approval Checkpoint:** Agent reaches step 8 (open PR). TrueForge visibly pauses execution at `user.tool_approval`.
> - **Operator Console:** Inspect the Evidence Package and Blast Radius. Show why policy marked it as requiring approval. Click **[Approve]**.
> - **Resolution:** TrueForge creates the PR on GitHub, verifies `/health`, and records the monotonic audit timeline.

### 6:00 – 6:45: The Safety & Approval Boundary
> "Notice what made this safe:
> First, zero LLM reliance for authorization. The policy engine is 100% pure TypeScript with deterministic rules.
> Second, prompt-injection defense: external issues and logs are treated as untrusted data with strict tool boundaries.
> Third, defensive redaction: Bearer tokens, GitHub PATs, and AWS keys are automatically scrubbed from all logs and audit events."

### 6:45 – 7:20: The Role of TrueForge
> "Why did we build this on TrueForge?
> TrueForge provides the critical infrastructure enterprise agents need:
> - Native tool approval checkpoints (`user.tool_approval`) that halt execution at the runtime level.
> - First-class Daytona container sandboxing so untrusted generated code never touches the host.
> - Standardized MCP protocol integration for GitHub and telemetry tools.
> - Full session persistence and streaming APIs."

### 7:20 – 7:45: Real vs. Mocked & Limitations
> "In the spirit of complete technical transparency:
> - **Real:** Deterministic policy engine, blast radius calculator, evidence provenance gating, TrueForge SDK integration, and 139 passing unit and integration tests.
> - **Controlled:** Incident `INC-001` and our checkout-api service are purpose-built demo fixtures to guarantee 100% reproducible evaluations.
> - **Current Limitations:** Runbook parser currently targets structured Markdown runbooks; arbitrary unstructured prose fails safely by design."

### 7:45 – 8:00: Closing
> "RunbookAI gives engineering teams the speed of autonomous remediation with the safety guarantees required for production infrastructure. 
> *It acts until acting becomes dangerous.* Thank you, and we are ready for your questions."

---

## 4-Minute Technical Q&A Defense

#### Q1: Why TrueForge instead of standard OpenAI function calling?
> **Answer:** Standard function calling gives you a model prediction, but zero runtime infrastructure. TrueForge provides native human checkpoints (`user.tool_approval`) that pause session state at the execution level, ephemeral Daytona sandbox environments for containerized tool execution, and unified MCP connection routing. We didn't have to invent a custom execution sandbox or approval broker; TrueForge handles the platform mechanics while RunbookAI enforces operational safety.

#### Q2: What code actually runs in the sandbox versus on the host machine?
> **Answer:** Host machine execution of generated code is strictly forbidden. The TrueForge sandbox executes: git clone, dependency installation, reproduction scripts (`repro.mjs`), remediation patches, and regression test suites (`vitest`). The host only runs the deterministic TypeScript policy engine and server.

#### Q3: How do you prevent an LLM from hallucinating that tests passed?
> **Answer:** Through strict Zod schema refinements on our `EvidencePackage`. Evidence items carry provenance tags (`TOOL_DERIVED`, `SANDBOX_DERIVED`, `MODEL_HYPOTHESIS`). Our `TestResultSchema` explicitly rejects any claim that `passed: true` if its provenance is `MODEL_HYPOTHESIS`. The model cannot approve its own work.

#### Q4: How are secrets protected from exfiltration or prompt injection in logs?
> **Answer:** We employ two defense layers:
> 1. Untrusted content analysis: External logs, tickets, and diffs are scanned for adversarial control patterns (`ignore previous instructions`, `reveal API key`).
> 2. Defensive redaction: All logs, tool inputs, and audit events pass through a multi-pattern regex redactor that sanitizes Bearer tokens, GitHub PATs, AWS keys, OpenAI keys, and Daytona credentials.

#### Q5: Can an ambiguous or malicious runbook step execute dangerous commands?
> **Answer:** No. Our runbook compiler fails closed. Any step that cannot be deterministically mapped to a known safe classification throws a `RunbookParseError`. Ambiguous instructions are never defaulted to `READ_ONLY`.

#### Q6: How does your blast radius calculation work?
> **Answer:** It is a deterministic calculator over 8 dimensions: external systems touched, resources affected, customer-facing impact, data mutation, destructiveness, reversibility, rollback availability, and unknown dependencies. Rule precedence is strictly `BLOCKED` > `HIGH` > `MEDIUM` > `LOW`. No fuzzy or hallucinated numeric scores.

#### Q7: What would you build next?
> **Answer:** 
> 1. Multi-service dependency graph ingestion to compute blast radius across distributed Kubernetes clusters.
> 2. Automated canary deployments where the agent validates 1% production traffic in real time before full rollout.
> 3. Native bidirectional sync with Jira and PagerDuty for auto-resolving incident tickets with the immutable audit log.
