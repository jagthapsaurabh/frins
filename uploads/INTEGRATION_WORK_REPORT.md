# FRISMN Integration Work Report — 2026-10-11

## Implemented in this handover build
- Preserved the latest supplied `index(4).html` as the website source at `launch-website/index.html`; no visual redesign was intentionally made.
- Rewired the booking form to same-origin `POST /api/leads`.
- Added a Prototype Dashboard navigation link and `/prototype` route serving the exact supplied `FRISMN Prototype(1).html` file.
- Added `/discovery` frontend that calls existing `/api/discovery/start`, `/api/discovery/answer`, and `/api/discovery/synthesize` endpoints.
- Added Fastify routes to serve website, Discovery and dashboard pages from the API server origin.

## Not claimed
- No full browser click-through test or live database test was executed in this environment.
- The original dashboard is preserved; its demo actions are not thereby converted into persisted backend operations.
- Guide/Admin authentication and authorization, learner-specific PDP persistence, full production AI integration, and production deployment remain outside this wiring change.

## Runtime acceptance commands
Copy `packages/server/.env.example` to `packages/server/.env`, then run `npm install`
`npm run prisma:generate --workspace=packages/server`
`npm run prisma:migrate --workspace=packages/server`
`npm run build`
`npm start`

Then verify `/api/health`, `/`, `/discovery`, `/prototype`, booking lead persistence, and at least one full Discovery session.
