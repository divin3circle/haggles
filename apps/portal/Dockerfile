# syntax=docker/dockerfile:1
# Multi-stage Dockerfile for @haggles/portal (SPEC.md section 14.1)
FROM oven/bun:1-slim AS base
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=bun,target=/root/.bun/install/cache bun install --frozen-lockfile
RUN bun run --filter @haggles/core build && bun run --filter @haggles/portal build

FROM oven/bun:1-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3000
RUN apt-get update && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*
USER bun
WORKDIR /app
COPY --from=build --chown=bun:bun /repo ./
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s CMD bun -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bun", "--filter", "@haggles/portal", "run", "start"]
