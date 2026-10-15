---
name: sponsorship-disclosure
description: FTC and X paid-partnership disclosure guidance for sponsored posts. Use when writing a creator brief, drafting sponsored post copy, or when verification fails on disclosure.
---

# Disclosure rules for sponsored X posts

Not legal advice; point users to the sources below for their situation.

**FTC (US): Endorsement Guides, 16 CFR Part 255, and "Disclosures 101 for Social Media Influencers".**
- Any material connection (payment, free product, discount, affiliate commission, family/employment) must be disclosed.
- The disclosure must be **clear and conspicuous**: in the post itself, in plain words, where people will see it without clicking "show more". Put it near the start of longer posts.
- Good: `#ad`, `#sponsored`, `Ad:`, "Paid partnership with <Brand>". Weak/insufficient: `#sp`, `#spon`, `#collab`, `#thanks`, a disclosure only in the bio, or hidden in a pile of hashtags.
- Creators can't claim experience they don't have or make claims the brand couldn't substantiate.
- Source: https://www.ftc.gov/business-guidance/resources/disclosures-101-social-media-influencers

**X paid partnerships policy.**
- X requires paid partnerships to be disclosed. Use X's **paid-partnership label** when it is available on the account, and also include a text disclosure such as `#ad` or `#paidpartnership`.
- Some categories are restricted or banned for paid promotion on X (e.g. certain financial products, gambling, weapons, adult content, political content). Check X's policy before accepting.
- Source: https://help.x.com/en/rules-and-policies/paid-partnerships-policy

**How this plugin enforces it.**
- Every offer carries `disclosure` markers (default `#ad, #sponsored, #paidpartnership, paid partnership`). `verify_deal_post` fails unless at least one appears **in the post text**.
- The X API does not expose the paid-partnership label, so the server can't check it. Ask the creator to confirm they turned it on.

When drafting copy for a creator, put the disclosure first or right after the hook. Example: `#ad trying AgentLens for my coding agents...`.
