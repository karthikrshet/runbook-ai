# RunbookAI dashboard: builds the React client, then runs the Node server that serves
# it and /api. Build from the repository root:  docker build -t runbook-dashboard .
# Configuration is read from the environment at runtime; see .env.example.

# Dependencies, cached until a package manifest changes.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/dashboard/package.json apps/dashboard/
COPY packages/core/package.json packages/core/
RUN npm ci --no-audit --no-fund

# The client bundle (Vite). Its asset URLs are relative, so it works under any path prefix.
FROM deps AS build
COPY . .
RUN npm run build

# Runtime: production dependencies, the TypeScript server (run by tsx, as `npm start`
# does), the runbooks and the built client. The fixture is needed for DASHBOARD_SOURCE=fixture.
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/dashboard/package.json apps/dashboard/
COPY packages/core/package.json packages/core/
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY packages/core/src packages/core/src
COPY apps/dashboard/server apps/dashboard/server
COPY apps/dashboard/shared apps/dashboard/shared
COPY apps/dashboard/fixtures apps/dashboard/fixtures
COPY runbooks runbooks
COPY --from=build /app/apps/dashboard/dist/client apps/dashboard/dist/client

# Inside a container the server must listen on all interfaces; the platform's ingress
# is the only way in. Browsers still need DASHBOARD_ALLOWED_HOSTS set to the public host.
ENV DASHBOARD_HOST=0.0.0.0 \
    DASHBOARD_PORT=8791
EXPOSE 8791
USER node
WORKDIR /app/apps/dashboard
# `node --import tsx` keeps the server in one process, so SIGTERM reaches its shutdown handler.
CMD ["node", "--import", "tsx", "server/main.ts"]
