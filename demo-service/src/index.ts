import { createApp } from "./server.js";

const port = Number(process.env.PORT ?? "3000");
const server = createApp({ simulateRegression: process.env.SIMULATE_BUG !== "false" });

server.listen(port, () => {
  console.log(`checkout-api listening on http://127.0.0.1:${port}`);
});
