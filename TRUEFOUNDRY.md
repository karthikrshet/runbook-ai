# Deploying RunbookAI on TrueFoundry

RunbookAI's operator console runs as one TrueFoundry **Service**. It is a Node server that
serves the React console and its `/api`, built from this repository's `Dockerfile`. The server
talks to TrueForge on the browser's behalf; the TrueForge token never reaches the browser.

## Before you deploy

1. In `truefoundry.yaml`, replace every `<placeholder>`:
   - `ports[0].host`: a host under a domain configured on your cluster. TrueFoundry's UI
     suggests one in the form `<service>-<workspace>-<port>.<base-domain>`.
   - `DASHBOARD_ALLOWED_HOSTS`: the same host. The server refuses any other Host header
     with `421 Unexpected Host header`.
2. Choose the data source:
   - `DASHBOARD_SOURCE: fixture` (as shipped): the synthetic INC-001 replay. It needs no
     TrueForge, is labelled as demo data everywhere, and cannot approve anything.
   - `DASHBOARD_SOURCE: trueforge`: a live TrueForge server (see [Going live](#going-live-with-trueforge)).
3. Keep `auth` on the port. The console can forward approvals to TrueForge, so it must not
   be public. `truefoundry_oauth` asks for a TrueFoundry login; `/api/health` bypasses it so
   uptime checks work.

## Deploy with the CLI

No git repository needed. From the repository root:

```sh
pip install -U truefoundry
tfy login --host https://<your-org>.truefoundry.cloud
tfy deploy -f truefoundry.yaml -w <cluster>:<workspace>
```

With Docker running, the CLI builds the image locally for `linux/amd64` and pushes it;
`.dockerignore` keeps `node_modules` and `.env` out of it. Without Docker it uploads the
folder for a remote build, filtered by `.tfyignore`. This folder is not a git repository, so
`.tfyignore` is what keeps `.env` from being uploaded. Do not delete it.

## Deploy from GitHub in the TrueFoundry UI

1. Push this folder to a GitHub repository (`.gitignore` already excludes `.env`).
2. **Deployments → New Deployment → Service**, pick the workspace, then **Git repo** and
   your repository.
3. Build: **Dockerfile**. Path to build context `./`, path to Dockerfile `./Dockerfile`.
4. Ports: `8791`, TCP, HTTP, **Expose** on, with the host TrueFoundry suggests. Turn on
   authentication (**Login with TrueFoundry**) and bypass `/api/health`.
5. Environment variables: paste the `env` block from `truefoundry.yaml` with your host.
6. Health checks (advanced): HTTP `GET /api/health` on port `8791` for startup, readiness
   and liveness.
7. Resources: 0.1 to 0.5 CPU and 256 to 512 MB memory are plenty.

After the first deploy, the service's Edit page offers **Deploy Using YAML** if you want the
generated spec in the repository.

## Going live with TrueForge

| Variable                                                                      | Set it to                                                                                                                          |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `DASHBOARD_SOURCE`                                                            | `trueforge`                                                                                                                        |
| `TRUEFORGE_BASE_URL`                                                          | Where the console calls TrueForge's API. In the same cluster: `http://<service>.<workspace>.svc.cluster.local:8790`                |
| `TRUEFORGE_PUBLIC_URL`                                                        | Where browsers open TrueForge for "Open in TrueForge" links, if different                                                          |
| `TRUEFORGE_TOKEN`                                                             | Only if TrueForge has auth on. Store it under TrueFoundry Secrets and reference it as `tfy-secret://<tenant>:<secret-group>:<key>` |
| `TRUEFORGE_AGENT_NAME`, `RUNBOOKAI_MCP_SERVER_NAME`, `GITHUB_MCP_SERVER_NAME` | The names configured in TrueForge                                                                                                  |
| `DASHBOARD_DECISIONS`, `DASHBOARD_START_RUNS`                                 | `'on'` to approve, reject and start runs from the console, `'off'` for view-only                                                   |

Notes:

- TrueForge's API token is the user's OIDC ID token, which expires, and TrueForge has no
  client-credentials flow yet. Plan to rotate `TRUEFORGE_TOKEN`, or reach an internal
  TrueForge that has auth off over the cluster network only.
- For TrueFoundry's hosted TrueForge (Agent Platform), TrueFoundry's public docs do not yet
  give the API base URL or auth scheme. Ask TrueFoundry for them.
- Approve and Reject in the console are forwarded to TrueForge's own tool approval, and only
  while TrueForge's record shows the call is waiting. The server never forwards an approval for
  an action RunbookAI's policy forbids.

## Check it

- `https://<host>/api/health` answers `{"ok":true}`.
- `https://<host>/` shows the console. The header badge reads **Demo data** for the fixture,
  otherwise `DASHBOARD_ENVIRONMENT` or **Live**. The TrueForge indicator reads **Connected**
  only while a live session is streaming.
- Demo: open `?session=fixture-inc-001-awaiting`. The replay advances step by step and stops
  at the approval boundary. It restarts once every tab watching it is closed.
- Under a path prefix, open the URL with its trailing slash: `https://<domain>/runbook/`.

## Troubleshooting

| Symptom                        | Fix                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| `421 Unexpected Host header`   | Add the host to `DASHBOARD_ALLOWED_HOSTS`. The pod log prints the refused value.           |
| The pod never becomes ready    | Probes must call `/api/health` on the port the server listens on (`DASHBOARD_PORT`, 8791). |
| "Can't reach TrueForge at …"   | Check `TRUEFORGE_BASE_URL` from inside the cluster. The console keeps retrying on its own. |
| Blank page under a path prefix | Add the trailing slash to the URL.                                                         |
| "Reconnecting" for a moment    | Normal after a rollout or an ingress timeout. The stream reconnects and resumes.           |

## Run the image locally

```sh
docker build -t runbook-dashboard .
docker run --rm -p 8791:8791 -e DASHBOARD_SOURCE=fixture runbook-dashboard
```

Then open <http://localhost:8791/?session=fixture-inc-001-awaiting>. When you map a different
host port, allow it: `-e DASHBOARD_ALLOWED_HOSTS=localhost:<port>`.
