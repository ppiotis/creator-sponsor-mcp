---
name: creator-onboarding
description: Onboard an X creator into the Creator Sponsor marketplace - analyse their profile, explain niche, audience, engagement and price-per-post, and save the profile with approval. Use when a creator wants to join, or someone asks "what is my account worth per sponsored post?".
---

# Creator onboarding

1. **Check the source.** Call `data_source_status`.
   - `x_api`: you can fetch by handle (read-only X API v2, token from `X_BEARER_TOKEN`).
   - `fixture`: demo data only (handles in the fixture file).
   - `none`: ask the user for their follower count, bio and 10-30 recent posts with likes, reposts, replies (and impressions if they have X analytics). Pass them as `manual`.
   Never ask the user to paste their X token into chat. It belongs in the server's environment only.
2. **Analyse.** `analyze_creator` with `username` or `manual`. Nothing is saved.
3. **Explain.** Use the returned `narrative_prompt` to write a 3-4 sentence summary. Then show:
   - niches with shares, audience summary, content style highlights
   - engagement: avg likes / reposts / replies and `engagement_rate` (state its `engagement_rate_basis`)
   - price range `low`-`high` USD, plus the formula line and the inputs (expected impressions, CPM band, multiplier)
   - every `data_quality` caveat. Never round the price into a promise; it is an estimate for negotiation.
4. **Save with approval.** `save_creator_profile` (same input, optional `payout_handle` such as their X Money handle) returns a preview. Show the summary, get a yes, then call again with `confirm_token`.
5. **Next.** Offer to brief them on disclosure rules (see the sponsorship-disclosure skill).

Re-run steps 2-4 monthly or after big growth; saving again refreshes the analysis (destructive: it replaces the old snapshot).
