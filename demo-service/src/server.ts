import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { calculateCheckout, unpatchedCalculateCheckout, type CartItem, type PromoCode } from "./pricing.js";

export function createApp(options: { simulateRegression?: boolean } = {}) {
  const simulateRegression = options.simulateRegression ?? true;

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");

      if ((req.method === "GET" || req.method === "HEAD") && (url.pathname === "/" || url.pathname === "/index.html")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        res.end(renderDemoUi(simulateRegression));
        return;
      }

      if (req.method === "GET" && url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", service: "checkout-api", version: "1.4.0" }));
        return;
      }

      if (req.method === "POST" && url.pathname === "/checkout") {
        let body = "";
        for await (const chunk of req) {
          body += String(chunk);
        }

        try {
          const payload = JSON.parse(body || "{}") as { items?: CartItem[]; promo?: PromoCode };
          if (!payload.items || payload.items.length === 0) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Cart items are required" }));
            return;
          }

          // Use unpatched logic if simulating release 1.4.0 bug
          const result = simulateRegression
            ? unpatchedCalculateCheckout(payload.items, payload.promo)
            : calculateCheckout(payload.items, payload.promo);

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Internal Server Error";
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: message, incidentId: "INC-001" }));
        }
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not Found" }));
    })();
  });

  return server;
}

function renderDemoUi(simulateRegression: boolean): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>checkout-api · Incident INC-001 Target Service</title>
  <style>
    :root {
      --bg: #0c0e12;
      --card: #151922;
      --card-border: #232b3a;
      --text: #e6edf3;
      --muted: #8b949e;
      --accent: #58a6ff;
      --danger: #f85149;
      --warning: #d29922;
      --success: #3fb950;
      --code-bg: #0d1117;
      --font-mono: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
      --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font-sans);
      line-height: 1.5;
      padding: 2rem 1.5rem;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .container {
      width: 100%;
      max-width: 900px;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--card-border);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .brand-logo {
      width: 36px;
      height: 36px;
      background: linear-gradient(135deg, #1f6feb, #8957e5);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      color: white;
      font-size: 1.1rem;
    }
    .brand-title {
      font-size: 1.25rem;
      font-weight: 700;
      letter-spacing: -0.01em;
    }
    .brand-subtitle {
      font-size: 0.8rem;
      color: var(--muted);
      font-mono: var(--font-mono);
    }
    .badges {
      display: flex;
      gap: 0.5rem;
      align-items: center;
      flex-wrap: wrap;
    }
    .badge {
      font-size: 0.75rem;
      font-family: var(--font-mono);
      font-weight: 600;
      padding: 0.2rem 0.55rem;
      border-radius: 12px;
      border: 1px solid;
    }
    .badge--danger {
      background: rgba(248, 81, 73, 0.15);
      color: #ff7b72;
      border-color: rgba(248, 81, 73, 0.4);
    }
    .badge--success {
      background: rgba(63, 185, 80, 0.15);
      color: #7ee787;
      border-color: rgba(63, 185, 80, 0.4);
    }
    .badge--neutral {
      background: rgba(110, 118, 129, 0.15);
      color: #c9d1d9;
      border-color: rgba(110, 118, 129, 0.3);
    }
    .alert-banner {
      background: linear-gradient(180deg, rgba(210, 153, 34, 0.15) 0%, rgba(210, 153, 34, 0.05) 100%);
      border: 1px solid rgba(210, 153, 34, 0.4);
      border-radius: 10px;
      padding: 1rem 1.25rem;
      display: flex;
      gap: 1rem;
      align-items: flex-start;
    }
    .alert-icon {
      font-size: 1.4rem;
      line-height: 1;
    }
    .alert-content h2 {
      font-size: 0.95rem;
      font-weight: 600;
      color: #f0883e;
      margin-bottom: 0.25rem;
    }
    .alert-content p {
      font-size: 0.85rem;
      color: var(--text);
    }
    .card {
      background: var(--card);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .card h3 {
      font-size: 1rem;
      font-weight: 600;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 1rem;
    }
    .btn {
      background: #21262d;
      color: var(--text);
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 0.65rem 1rem;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      transition: all 0.15s ease;
      text-decoration: none;
    }
    .btn:hover {
      background: #30363d;
      border-color: #8b949e;
    }
    .btn--primary {
      background: #238636;
      border-color: rgba(240, 246, 252, 0.1);
      color: #fff;
    }
    .btn--primary:hover {
      background: #2ea043;
    }
    .btn--danger {
      background: rgba(248, 81, 73, 0.15);
      border-color: rgba(248, 81, 73, 0.4);
      color: #ff7b72;
    }
    .btn--danger:hover {
      background: rgba(248, 81, 73, 0.25);
      border-color: #f85149;
    }
    .btn--console {
      background: linear-gradient(135deg, #1f6feb, #8957e5);
      border-color: transparent;
      color: #fff;
    }
    .btn--console:hover {
      opacity: 0.92;
    }
    .console-box {
      background: var(--code-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 1rem;
      font-family: var(--font-mono);
      font-size: 0.82rem;
      color: #7ee787;
      overflow-x: auto;
      min-height: 120px;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .console-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.5rem;
      font-size: 0.75rem;
      color: var(--muted);
    }
    .status-pill {
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      font-weight: 700;
    }
    .status-pill--200 { background: rgba(63, 185, 80, 0.2); color: #7ee787; }
    .status-pill--500 { background: rgba(248, 81, 73, 0.25); color: #ff7b72; }
    footer {
      text-align: center;
      font-size: 0.8rem;
      color: var(--muted);
      margin-top: 1rem;
    }
    footer a { color: var(--accent); text-decoration: none; }
    footer a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <div class="brand-logo">CA</div>
        <div>
          <div class="brand-title">checkout-api</div>
          <div class="brand-subtitle">INC-001 Target Microservice · port 8792 / 3000</div>
        </div>
      </div>
      <div class="badges">
        <span class="badge badge--neutral">v1.4.0</span>
        ${
          simulateRegression
            ? '<span class="badge badge--danger">💥 REGRESSION ACTIVE</span>'
            : '<span class="badge badge--success">✅ PATCHED</span>'
        }
        <a href="http://127.0.0.1:8791/?session=fixture-inc-001-awaiting" class="btn btn--console" target="_blank">
          Open RunbookAI Console (8791) →
        </a>
      </div>
    </header>

    <div class="alert-banner">
      <div class="alert-icon">⚠️</div>
      <div class="alert-content">
        <h2>Active Incident: INC-001 (Release 1.4.0 Promo Code Regression)</h2>
        <p>
          Commit <code>9f3c2ab</code> introduced promo code calculation, but introduced a null dereference when customers checkout without a promo code. 
          Use the interactive probe below to verify health or trigger the live regression error.
        </p>
      </div>
    </div>

    <div class="card">
      <h3>
        <span>Interactive API Probes</span>
        <span style="font-size: 0.8rem; font-weight: normal; color: var(--muted);">Click to trigger live HTTP requests</span>
      </h3>
      <div class="grid">
        <button class="btn btn--primary" onclick="runProbe('/health', 'GET')">
          🩺 Probe Health (GET /health)
        </button>
        <button class="btn btn--danger" onclick="triggerBug()">
          💥 Trigger Bug: No Promo (POST /checkout)
        </button>
        <button class="btn" onclick="testPromo()">
          🏷️ Test With Promo SAVE10 (POST /checkout)
        </button>
      </div>
    </div>

    <div class="card">
      <div class="console-header">
        <span id="output-meta">Live Response Inspector · Ready</span>
        <span id="status-pill" class="status-pill" style="display:none;"></span>
      </div>
      <pre id="output" class="console-box">// Click any button above to test endpoints in real time...</pre>
    </div>

    <div class="card">
      <h3>RunbookAI Incident Operations Flow</h3>
      <p style="font-size: 0.85rem; color: var(--muted);">
        The autonomous operator at <a href="http://127.0.0.1:8791" style="color:var(--accent);">http://127.0.0.1:8791</a> is currently executing runbook <code>checkout-incident.md</code>:
      </p>
      <div style="font-size: 0.85rem; display: flex; flex-direction: column; gap: 0.4rem; font-family: var(--font-mono);">
        <div>1. <code>aws_get_health</code> ➔ 200 OK service alive</div>
        <div>2. <code>aws_get_logs</code> ➔ Detected TypeError: Cannot read properties of undefined (reading 'discount')</div>
        <div>3. <code>github_get_recent_commits</code> ➔ Identified regression commit 9f3c2ab</div>
        <div>4. <code>Daytona Sandbox</code> ➔ Isolated reproduction & Vitest patch validation</div>
        <div>5. <code>Evidence Gate</code> ➔ Verified 100% tests pass & zero lint/typecheck errors</div>
        <div>6. <code>Approval Boundary</code> ➔ <strong>Halted for Human Authorization before opening GitHub PR</strong></div>
      </div>
      <div style="display: flex; gap: 0.75rem; margin-top: 0.5rem; flex-wrap: wrap;">
        <a href="http://127.0.0.1:8791/?session=fixture-inc-001-awaiting" class="btn btn--console" target="_blank">
          View Step 8 Decision Checkpoint (8791)
        </a>
        <a href="http://127.0.0.1:8791/?session=fixture-inc-001-resolved" class="btn" target="_blank">
          View Resolved Incident & Audit Trail
        </a>
        <a href="http://127.0.0.1:8791/?session=fixture-inc-001-awaiting&view=report" class="btn" target="_blank">
          View Post-Mortem Report
        </a>
      </div>
    </div>

    <footer>
      RunbookAI · Evidence-Gated Autonomous Operations · "The model proposes. Policy authorizes."
    </footer>
  </div>

  <script>
    async function runProbe(path, method, body) {
      const out = document.getElementById('output');
      const meta = document.getElementById('output-meta');
      const pill = document.getElementById('status-pill');
      meta.textContent = \`Requesting \${method} \${path}...\`;
      pill.style.display = 'none';

      const t0 = performance.now();
      try {
        const opts = { method, headers: {} };
        if (body) {
          opts.headers['Content-Type'] = 'application/json';
          opts.body = JSON.stringify(body);
        }
        const res = await fetch(path, opts);
        const data = await res.json();
        const duration = Math.round(performance.now() - t0);

        pill.textContent = \`HTTP \${res.status} \${res.statusText || ''}\`;
        pill.className = \`status-pill status-pill--\${res.status === 200 ? '200' : '500'}\`;
        pill.style.display = 'inline-block';
        meta.textContent = \`Response from \${method} \${path} in \${duration}ms\`;

        out.textContent = JSON.stringify(data, null, 2);
        out.style.color = res.status === 200 ? '#7ee787' : '#ff7b72';
      } catch (err) {
        meta.textContent = 'Request Failed';
        out.textContent = String(err);
        out.style.color = '#ff7b72';
      }
    }

    function triggerBug() {
      runProbe('/checkout', 'POST', {
        items: [{ sku: 'PROD-SHOES-01', qty: 1, price: 120 }]
      });
    }

    function testPromo() {
      runProbe('/checkout', 'POST', {
        items: [{ sku: 'PROD-SHOES-01', qty: 1, price: 120 }],
        promo: { code: 'SAVE10', discount: { percent: 10 } }
      });
    }
  </script>
</body>
</html>`;
}

