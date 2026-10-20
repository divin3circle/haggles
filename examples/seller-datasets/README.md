# `@haggles/example-seller-datasets` (Hono)

Sample dataset seller API demonstrating `@haggles/server/hono` (`SPEC.md` section 12.1).

## Endpoints

| Route | Price | Description |
|---|---|---|
| `GET /datasets/summary` | Free | Lists available cities (`austin`, `chicago`, `seattle`) and dataset notice |
| `GET /datasets/rent-index?city=austin` | `$0.03` | Median 1BR/2BR rent & vacancy benchmark |
| `GET /datasets/transit-fares?city=austin` | `$0.01` | Single-ride, day-pass, and monthly-pass transit fares |

## Run in under 2 minutes

```bash
export HAGGLES_FACILITATOR_URL="http://localhost:3001"
export HAGGLES_SELLER_ID="slr_..."
export HAGGLES_SELLER_KEY="hgs_test_..."
bun --filter '@haggles/example-seller-datasets' dev
```
