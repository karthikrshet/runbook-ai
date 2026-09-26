# RunbookAI: 3-Minute Demo Video Script

**Target Duration:** Exactly 2:55 – 3:00  
**Resolution:** 1080p (1920x1080)  
**Mandatory Requirement:** At least 30 continuous seconds visibly showing TrueForge in action (UI/SDK).

---

## Storyboard & Timestamp Breakdown

| Timestamp | Visual Cue | Voiceover Script | TrueForge Visibility |
|---|---|---|---|
| **0:00 – 0:15** | Split screen: Alert PagerDuty incident spike ("checkout-api 500 spike after release 1.4.0") and static markdown runbook. | *"Operational runbooks are full of repetitive diagnostic steps. But giving autonomous agents unrestricted write access to production is dangerous. One wrong command can delete databases or leak secrets."* | Intro Title & Architecture |
| **0:15 – 0:30** | Diagram transition: RunbookAI architecture. Show TrueForge orchestration connected to MCP, Daytona sandbox, Evidence Gate, and Approval Checkpoint. | *"Introducing RunbookAI: Evidence-Gated Autonomous Operations. Our core principle is: The model proposes. Policy authorizes. The LLM is never the final authority."* | Architectural Diagram |
| **0:30 – 1:15** *(45s continuous)* | **TrueForge Console View:** Show user typing prompt in TrueForge: `"Execute runbook checkout-incident.md for INC-001..."`. TrueForge agent starts running. Tool calls stream live: `aws_get_health`, `aws_get_logs`, `github_get_recent_commits`. Suspicious commit `9f3c2ab` identified. | *"We trigger RunbookAI in TrueForge. TrueForge queries live CloudWatch logs and recent GitHub commits via MCP. It spots commit 9f3c2ab which introduced promo codes. Instead of testing on the host, TrueForge provisions an isolated Daytona sandbox container."* | **TRUEFORGE LIVE VIEW (>=30s continuous requirement)** |
| **1:15 – 1:55** | **TrueForge Sandbox Execution:** TrueForge invokes `exec` tool. Repro script runs: `POST /checkout` returns 500 without promo. Agent formulates candidate patch. First vitest attempt runs inside sandbox: 1 test fails. Agent analyzes failure, refines patch, and vitest runs again: 12/12 pass! | *"Inside the sandbox, generated reproduction code proves the bug: checking out without a promo throws a 500. The agent writes a candidate patch and tests it. Notice the first attempt failed! The agent saw the test failure, revised the fix, and re-ran tests until all 12 unit tests and health probes passed."* | **TRUEFORGE LIVE VIEW (Tool calls & Sandbox logs)** |
| **1:55 – 2:15** | **TrueForge Approval Checkpoint:** Agent encounters step 8: external state change required. TrueForge halts at a native `user.tool_approval` checkpoint. Proposed action: `github_create_pull_request`. | *"Now the runbook reaches step 8: applying an external state change. The agent wants to open a pull request. But because this touches an external system, TrueForge halts immediately at a human approval checkpoint. Blind autonomy stops here."* | **TRUEFORGE APPROVAL CHECKPOINT** |
| **2:15 – 2:40** | **RunbookAI Operator Console (http://localhost:8791):** Switch to the RunbookAI dashboard. Highlight: Evidence Gate (all checks passed with SANDBOX_DERIVED provenance), Blast Radius (LOW risk, 1 service, zero data mutation, clean rollback available). Click **[Approve]**. | *"In the RunbookAI operator console, we inspect the Evidence Package. Notice that model hypothesis alone can never unlock this gate—it requires verified sandbox execution evidence. The blast radius engine deterministically calculates risk. We click Approve."* | RunbookAI Operator Console |
| **2:40 – 2:55** | **Verified Recovery:** Back to TrueForge. Approved PR is opened on GitHub. Health verification probe confirms `POST /checkout` returns 200. Audit timeline finishes. | *"The approval returns to TrueForge. The pull request is opened on GitHub, post-action health verification succeeds, and an immutable audit timeline is committed."* | TrueForge + GitHub PR |
| **2:55 – 3:00** | Final punchline card: RunbookAI logo and GitHub URL. | *"RunbookAI: It acts until acting becomes dangerous."* | Outro Card |

---

## Recording Checklist
- [ ] Total recording time is between 2:50 and 2:58 (strictly under 3:00).
- [ ] At least 30 continuous seconds show TrueForge web UI / CLI / tool logs (0:30–1:15).
- [ ] Video exported at 1080p 60fps MP4.
- [ ] Narration or high-contrast subtitle captions enabled.
- [ ] Google Drive link permissions set to: *"Anyone on the internet with the link can view"*.
