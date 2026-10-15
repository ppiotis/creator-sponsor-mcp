---
name: brand-matching
description: Turn a company's product brief into a ranked shortlist of X creators and a compliant sponsorship offer. Use when a brand says "find creators for my product" or wants to make an offer.
---

# Brand matching and offers

1. **Collect the brief**: product name, one-paragraph description, budget per post (max, optional min) in USD, optional minimum followers, post language(s), and target niches if the brand knows them. Valid niches: `ai_tech, finance, business, space_science, gaming, fitness_health, lifestyle, creative, news_politics`.
2. **Rank.** `match_creators`. Present the top 3-5 as a table: handle, score, niche / audience / budget components, estimated price range, suggested offer, and the `reasons`. Say plainly that scores are deterministic: `0.5 niche + 0.2 audience + 0.3 budget`.
3. **Dig in** on request with `get_creator` (full analysis and past deals).
4. **Make the offer** with `create_offer`:
   - `amount` and `currency`. The preview tells you whether it's within the creator's estimate.
   - `must_include_phrases` (brand or product name) and/or `must_include_link` (landing page).
   - `disclosure` defaults to `#ad, #sponsored, #paidpartnership, paid partnership`. Don't remove disclosure; you may narrow it (e.g. only `#ad`).
   - optional `post_by` date.
   Show the preview and confirm only after the brand approves. Share the returned `creator_brief` with the creator.
5. The creator (or the user acting for them) accepts or declines with `respond_to_offer`, preview then confirm.

Never contact creators yourself. This server cannot send DMs or post; if the user wants outreach, draft it for them to send.
