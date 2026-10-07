# Haggles

**Haggles lets any developer put a price on an HTTP endpoint and get paid in real money (via PayPal) by AI agents that pay automatically, within limits their owners set.**

An open protocol (x402-inspired, settled on PayPal rails), a hosted facilitator, TypeScript SDKs, and a web portal.

> Status: early development. See `SPEC.md` for the full product and engineering specification.

## Repository layout

```
haggles/
├─ apps/
│  ├─ portal/    # Next.js web portal (Buy + Sell sections)
│  ├─ api/       # Fastify facilitator + portal API        (planned, M1-M3)
│  ├─ worker/    # pg-boss background jobs                 (planned, M2)
│  └─ docs/      # Astro Starlight docs site               (planned, M8)
├─ packages/
│  ├─ core/      # @haggles/core - protocol, money, errors (planned, M1)
│  ├─ client/    # @haggles/client - paying fetch for agents (planned, M4)
│  └─ server/    # @haggles/server - paywall middleware     (planned, M4)
└─ examples/     # demo sellers + research agent           (planned, M7)
```

## Development

Prerequisites: [Bun](https://bun.sh) 1.3+ and Docker.

```bash
bun install
bun run db:up        # Postgres 16 + Redis 7 via docker compose
bun run dev:portal   # portal at http://localhost:3000
```

## License

[MIT](LICENSE)
