<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Push to `main` deploys to production

There is no separate release step. Every commit that lands on `main` triggers
`.github/workflows/deploy.yml`, which lints, tests, builds two images to GHCR and
SSHes into the VPS — tl-sport.ru is live with the change ~2–3 minutes later, and
`prisma migrate deploy` runs against the production database as part of it.

So treat a push to `main` as the deploy. Never tell the user that production is
still on the old build "until someone deploys". If a change should not go live
yet, keep it on a branch. Rollback is `IMAGE_TAG=<sha> ./deploy.sh <host>`.

See the deploy section of README.md for the full pipeline.
