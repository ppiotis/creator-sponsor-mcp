<p align="center"><img src="logo.svg" width="96" alt="Creator Sponsor logo"></p>

# Creator Sponsor MCP

[![CI](https://github.com/ppiotis/creator-sponsor-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/ppiotis/creator-sponsor-mcp/actions/workflows/ci.yml)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)

**A sponsorship marketplace for X creators, run by your agent.** It analyses a creator's public X profile and recent posts to work out their niche, audience, content style and engagement. It estimates a price per sponsored post with a **transparent formula**, ranks creators against a brand's product brief, and runs the deal: offer, accept, verify the post (author, content, link and **#ad disclosure**), then record the payout.

- **Every state change is previewed and needs your confirmation.**
- **It never posts to X and never moves money.**
- **Its only network access is read-only GETs to `api.x.com`, and only when you set a token.**

## How it works

```
creator: analyze_creator -> save_creator_profile          (niche, audience, engagement, $ range)
brand:   match_creators  -> create_offer                  (explainable ranking, requirement + disclosure)
creator: respond_to_offer (accept)                        -> posts on X with #ad
anyone:  verify_deal_post (fetch post, run checks)        -> verified
brand:   pays in X Money / bank -> record_payout (ref)    -> paid
```

The server returns structured data plus a `narrative_prompt`. Your agent writes the prose, so there are **no LLM keys inside the server**.

## Tools

**Read-only** (`readOnlyHint: true`)

| Tool | Purpose |
|---|---|
| `data_source_status` | Active X source (`x_api` / `fixture` / `none`), data file, pricing assumptions, niche CPM bands. Never reveals the token |
| `analyze_creator` | Profile + metrics + price estimate + `narrative_prompt`, from the X API or `manual` input. Saves nothing. `openWorldHint: true` |
| `list_creators` / `get_creator` | Saved creator profiles |
| `match_creators` | Ranks saved creators for a brief, with niche, audience and budget components, reasons and a suggested offer |
| `list_deals` / `get_deal` | Deals, status counts, history, verification checks, payout |
| `list_payout_providers` / `list_payouts` | Providers (`moves_money: false`) and the payout ledger with totals |

**Writes**: two-step preview then confirm (`readOnlyHint: false`)

| Tool | `destructiveHint` | Purpose |
|---|---|---|
| `save_creator_profile` | true (replaces the previous snapshot) | Analyse and save or refresh a creator; optional `payout_handle` |
| `delete_creator` | true | Refused while the creator has open deals; past deals and payouts are kept |
| `create_offer` | false | Brand offer: amount, product, required phrases or link, disclosure markers, `post_by` |
| `respond_to_offer` | false | `offered` → `accepted` / `declined` |
| `cancel_deal` | true | `offered`/`accepted` → `cancelled` |
| `verify_deal_post` | false | Fetches the post and checks author, phrases, link, disclosure, and that it was posted after acceptance. Can only be confirmed if every check passes. `openWorldHint: true` |
| `record_payout` | false | `verified` → `paid` with a provider + reference. **Records a payment; never makes one** |

Lifecycle: `offered → accepted → verified → paid`, or `declined` / `cancelled`.

### Pricing formula

```
price = (expected_impressions / 1000) × CPM × engagement_multiplier
expected_impressions = median impressions of recent posts × 0.8   (or followers × 5% × 0.8 if no impression data)
engagement_multiplier = sqrt(engagement_rate / 1%), clamped to [0.5, 2.0]
engagement_rate = interactions / impressions   (or avg interactions per post / followers)
```

CPM bands are per-niche planning assumptions in USD, from $4–10 for General and News up to $15–30 for Finance. They are not market quotes. Every estimate returns its inputs and assumptions, so a brand can see exactly why it got that number. See `src/analysis.ts`.

### Matching score

`score = 0.5 × niche_fit + 0.2 × audience_fit + 0.3 × budget_fit`

- **Niche fit** is the overlap between the brief's detected or chosen niches and the creator's niche shares.
- **Audience fit** is reduced when the creator is below the minimum followers or posts in the wrong language.
- **Budget fit** compares the creator's estimated range with the budget.

Every result lists its reasons.

### Payouts

The payout step uses a pluggable `PayoutProvider` interface (`src/payout.ts`):

- **`manual`** (default) is a ledger entry. You pay the creator yourself, for example in X Money, and record the transaction reference.
- **`x_money`** is a stub, **pending a public X Money payouts API**. It always refuses and tells you to pay in X Money and record the payment with `manual`. When X publishes a payouts API, this adapter is where it would plug in, still behind preview and confirm.

## Install

Requires Node.js 20+. Add the plugin, or put this in `.mcp.json`:

```json
{
  "mcpServers": {
    "creator-sponsor": {
      "command": "npx",
      "args": ["-y", "https://github.com/ppiotis/creator-sponsor-mcp/archive/refs/tags/v1.0.0.tar.gz"],
      "env": {
        "X_BEARER_TOKEN": "<optional: X API v2 app-only bearer token>",
        "CREATOR_SPONSOR_PATH": "/absolute/path/to/creator-sponsor.json"
      }
    }
  }
}
```

| Env var | Default | Purpose |
|---|---|---|
| `X_BEARER_TOKEN` | unset | Optional. An X API v2 **app-only bearer token** (read-only: user lookup, user posts, post lookup). If unset, the server makes **no network calls** and you use `manual` input |
| `CREATOR_SPONSOR_FIXTURES` | unset | Optional. A local JSON file of demo users and posts, used instead of the API when there's no token. `fixtures/demo.json` ships with the repo |
| `CREATOR_SPONSOR_PATH` | `~/.creator-sponsor/data.json` | Data file. Must end in `.json`. Created on the first confirmed write with mode `0600` |
| `MCP_AUTH_TOKEN` | unset | HTTP only: require `Authorization: Bearer <token>` |
| `HOST` / `PORT` | `127.0.0.1` / `3000` | HTTP bind |

**X API access:** create a project and app at developer.x.com and copy the app's bearer token. The token can only read public data. You need an API tier that includes post lookup and user timelines.

From source: `git clone https://github.com/ppiotis/creator-sponsor-mcp && cd creator-sponsor-mcp && npm ci && npm run build && node dist/stdio.js`

### Remote (Streamable HTTP)

`node dist/serve-http.js` serves stateless Streamable HTTP at `/mcp`, with a health check at `GET /health`. The marketplace data is a local file, so run it on a machine you control, with an auth token:

```bash
CREATOR_SPONSOR_PATH=/data/cs.json MCP_AUTH_TOKEN=change-me X_BEARER_TOKEN=... HOST=0.0.0.0 PORT=3000 node dist/serve-http.js
docker build -t creator-sponsor-mcp . && docker run -p 3000:3000 -v "$HOME/.creator-sponsor:/data" -e CREATOR_SPONSOR_PATH=/data/cs.json -e MCP_AUTH_TOKEN=change-me creator-sponsor-mcp
```

Client: `{"url":"https://your-host/mcp","headers":{"Authorization":"Bearer change-me"}}`. Put TLS in front. Do not expose it without `MCP_AUTH_TOKEN`.

## Security & privacy

- **One outbound host, read-only.** The only network code is `src/xsource.ts`. It makes `GET` requests to `https://api.x.com/2`, with a hard-coded host check, `redirect: "error"` and a 15 s timeout, and only when `X_BEARER_TOKEN` is set. Unit tests assert the host, the method, and that **no fetch happens without a token**.
- **The token is never logged or returned.** Errors surface only the HTTP status and X's public error title. Tests assert the token never appears in any output, including `data_source_status`. An unexpanded `${X_BEARER_TOKEN}` placeholder is treated as unset.
- **No posting, no DMs, no money movement.** The server can't write to X. `record_payout` only records a payment you made elsewhere (`money_moved: false`). The X Money adapter is a refusing stub.
- **Human-in-the-loop writes.** Every write is a preview followed by a confirm. The confirm token is HMAC-SHA256, bound to the tool, the exact arguments and the store revision, expires after 10 minutes and is single-use. Tests cover wrong arguments, reuse, a stale revision and a malformed token. Verification can only be confirmed if every check still passes when it's re-run at confirm time.
- **Accurate annotations.** `readOnlyHint`, `destructiveHint` and `idempotentHint` are set on every tool, and `openWorldHint: true` only on the three tools that can call X.
- **Validated input.** Every tool uses zod schemas. Post URLs must be on `x.com` or `twitter.com`, usernames must match X's format, and ids, amounts, ISO currencies and dates are all checked.
- **Data safety.** Writes are atomic (temp file, then rename) and serialised. The data file is private (`0600`, folder `0700`). A corrupt file is reported and never overwritten.
- **Honest verification.** `manual_attestation` (for when there's no API) is stored as such, along with who attested it. The X API doesn't expose the paid-partnership label, so the skills tell creators to turn it on and the server checks only for a text disclosure.
- **Runtime dependencies** are the MCP SDK and `zod`. There's no telemetry.

## Skills

| Skill | Teaches the agent |
|---|---|
| `creator-onboarding` | Choosing a source, analysing, explaining the price formula and caveats, saving with approval |
| `brand-matching` | Collecting a brief, presenting explainable rankings, making a compliant offer |
| `verify-and-pay` | Verification checks, handling failures, manual attestation, recording a payout without ever moving money |
| `sponsorship-disclosure` | FTC Endorsement Guides and X paid-partnership policy, good vs weak disclosures, how the plugin enforces them |

## Reviewer test plan

Setup: no X account or token is needed. Add the plugin with
`CREATOR_SPONSOR_FIXTURES=<repo>/fixtures/demo.json` and `CREATOR_SPONSOR_PATH=/tmp/cs-review.json`.
The fixture contains three demo creators (`devdana`: AI/tech, `fitfelix`: fitness, `moneymaya`: finance) and three demo posts.

1. **Creator profile and price.** Ask: *"Analyse @devdana as a sponsorship creator."* → Expect niche **AI & tech**, avg likes **158.5**, engagement rate **1.77%** (interactions / impressions), and a price of **$136–$283 per post**. The formula should show 8,524 expected impressions, a $12–25 CPM and a ×1.33 multiplier. Nothing is saved, and `/tmp/cs-review.json` doesn't exist yet.
2. **Preview gate.** Ask: *"Save devdana, fitfelix and moneymaya to the marketplace."* → Expect three previews and a request to confirm. Say yes → `list_creators` shows 3.
3. **Brand matching.** Ask: *"I sell AgentLens, an AI coding agent tracer for developers. Budget $100–300 per post. Who should I sponsor?"* → Expect **devdana ranked #1** with score 1.0 and the reasons "niche overlap: ai_tech" and "fits budget". Then ask: *"Offer devdana $200, must link https://agentlens.dev/try."* → Expect a preview with the default disclosure markers (#ad, …) → confirm → a deal in status `offered`, plus a creator brief that mentions #ad.
4. **Verification with disclosure.** Ask: *"devdana accepted. Verify post 1950000000000000002."* → Expect accept preview → confirm, then verification **fails** on `disclosure` (no #ad) and nothing changes. Ask: *"Try https://x.com/devdana/status/1950000000000000001."* → all 5 checks pass → preview → confirm → `verified`. Post `1950000000000000003` fails the **author** check.
5. **Payout never moves money.** Ask: *"Pay devdana via X Money."* → Expect a refusal explaining there's no public X Money payouts API, and advice to pay in X Money and record the reference. Ask: *"I paid, reference XM-12345."* → Expect a `record_payout` preview saying no money is moved → confirm → deal `paid`, and the ledger total is USD 200.

## Development

```bash
npm ci
npm test               # build + unit tests (logic, mocked X API, tools) + e2e over stdio and Streamable HTTP
npm audit --omit=dev
```

## License

MIT © Paris Piotis
