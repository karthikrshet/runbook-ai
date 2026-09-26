import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { calculateCheckout, unpatchedCalculateCheckout, type CartItem, type PromoCode } from "./pricing.js";

export function createApp(options: { simulateRegression?: boolean } = {}) {
  const simulateRegression = options.simulateRegression ?? true;

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");

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
