---
name: verify-and-pay
description: Verify that a creator published the agreed sponsored post on X (author, content, link, disclosure) and record the payout in the ledger. Use when a creator says "it's posted" or a brand asks to pay a creator.
---

# Verify and pay

## Verify
1. Get the post URL or id from the creator. Find the deal with `list_deals` (status `accepted`).
2. `verify_deal_post` with `deal_id` and `post`. The server fetches the post from the X API and checks:
   author = deal creator; every required phrase; the required link (t.co links are expanded); at least one disclosure marker; posted after acceptance.
3. If `status: "failed"`, nothing changed. List the failed checks and what to fix (most often: missing `#ad`). The creator edits or reposts, then you verify again.
4. If all pass you get a preview. Show it, get approval, confirm. The deal becomes `verified`.
5. No X token? Only then use `manual_attestation` (author, exact post text, who checked it). It is stored as `manual_attestation`; tell the user it was not machine-verified.

## Pay
This server **never moves money**.
1. `list_payout_providers`: `manual` is available. `x_money` is a stub, pending a public X Money payouts API, and always refuses.
2. Tell the user to pay the creator themselves (for example in X Money to the creator's `payout_handle`), and to give you the transaction reference.
3. `record_payout` with `deal_id`, `provider: "manual"` and `reference`. Show the preview (it says no money is moved), confirm after approval. The deal becomes `paid`.
4. Never record a payout the user hasn't confirmed was actually made. Never invent references.
