import { createApp } from "./server.js";

const primaryPort = Number(process.env.PORT ?? "8792");
const secondaryPort = process.env.PORT ? null : 3000;

const server = createApp({ simulateRegression: process.env.SIMULATE_BUG !== "false" });

server.listen(primaryPort, () => {
  console.log(`checkout-api live UI & API listening on http://127.0.0.1:${primaryPort}`);
});

if (secondaryPort && secondaryPort !== primaryPort) {
  const secondaryServer = createApp({ simulateRegression: process.env.SIMULATE_BUG !== "false" });
  secondaryServer.listen(secondaryPort, () => {
    console.log(`checkout-api secondary listener on http://127.0.0.1:${secondaryPort}`);
  }).on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.log(`checkout-api port ${secondaryPort} in use; skipping secondary listener.`);
    } else {
      console.error(err);
    }
  });
}
