import { describe, expect, it } from "vitest";
import { createApp } from "../src/server.js";

describe("GET /health", () => {
  it("returns 200 OK and service metadata", async () => {
    const server = createApp();
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Server address not available");

    const res = await fetch(`http://127.0.0.1:${address.port}/health`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string; service: string; version: string };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("checkout-api");
    expect(body.version).toBe("1.4.0");

    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  });
});
