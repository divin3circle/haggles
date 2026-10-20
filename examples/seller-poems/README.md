# `@haggles/example-seller-poems` (Express)

Public-domain & CC0 poetry API demonstrating `@haggles/server/express` sub-cent (`$0.005`) and cent (`$0.02`) HTTP `402 Payment Required` metering (`SPEC.md` section 12.2).

## Endpoints

| Route | Price | Description |
|---|---|---|
| `GET /poems` | Free | Lists available poem IDs and authors |
| `GET /poems/random` | `$0.005` | Returns a random poem (sub-cent micro-payment) |
| `GET /poems/:id` | `$0.02` | Returns a specific poem by ID (`ozymandias`, `hope-is-the-thing-with-feathers`, `micro-ledger-haiku`) |

## Run in under 2 minutes

```bash
export HAGGLES_FACILITATOR_URL="http://localhost:3001"
export HAGGLES_SELLER_ID="slr_..."
export HAGGLES_SELLER_KEY="hgs_test_..."
bun --filter '@haggles/example-seller-poems' dev
```
