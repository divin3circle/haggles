# `@haggles/example-buyer-research-agent`

AI Research Assistant with a live **Spend** panel demonstrating `@haggles/client` and server-enforced spending policies (`SPEC.md` section 12.3).

## Tools

- `list_sources` — returns the catalogue of paid endpoints from `seller-datasets` and `seller-poems`.
- `buy_source(url)` — calls `haggles.fetch(url)`, verifies the signed `Haggles-Receipt`, and updates the live Spend panel (`Bought 3 sources for $0.07.`).

## Run in under 2 minutes

```bash
export HAGGLES_FACILITATOR_URL="http://localhost:3001"
export HAGGLES_KEY="hgk_test_..."
export SELLER_DATASETS_URL="http://localhost:4010"
export SELLER_POEMS_URL="http://localhost:4011"
# Optional: enable live Gemini via Vertex AI
# export GOOGLE_VERTEX_PROJECT="your-gcp-project"
bun --filter '@haggles/example-buyer-research-agent' dev
```

Open `http://localhost:4012` to interact with the Research Assistant and trigger the on-demand policy-hit guardrail.
