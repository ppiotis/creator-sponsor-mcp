import { classify, round } from "./analysis.js";
export const WEIGHTS = { niche: 0.5, audience: 0.2, budget: 0.3 };
export function briefNiches(b) {
    if (b.target_niches?.length)
        return Object.fromEntries(b.target_niches.map((n) => [n, 1 / b.target_niches.length]));
    return Object.fromEntries(classify([b.product, b.description ?? ""], 3).map((n) => [n.niche, n.share]));
}
export function scoreCreator(c, b, want) {
    const reasons = [];
    // Niche fit: overlap of niche share vectors (sum of min shares), 0..1
    const have = Object.fromEntries(c.analysis.niches.map((n) => [n.niche, n.share]));
    const wantKeys = Object.keys(want);
    let niche = 0;
    if (wantKeys.length) {
        niche = wantKeys.reduce((a, k) => a + Math.min(want[k], have[k] ?? 0), 0) / wantKeys.reduce((a, k) => a + want[k], 0);
        const shared = wantKeys.filter((k) => have[k]);
        reasons.push(shared.length ? `niche overlap: ${shared.join(", ")}` : `no overlap with brief niches (${wantKeys.join(", ")})`);
    }
    else {
        niche = 0.5;
        reasons.push("brief has no detectable niche; neutral niche score 0.5");
    }
    // Audience fit: followers minimum and language
    let audience = 1;
    if (b.min_followers && c.profile.followers < b.min_followers) {
        audience -= 0.6;
        reasons.push(`followers ${c.profile.followers} below minimum ${b.min_followers}`);
    }
    if (b.languages?.length) {
        const langs = c.analysis.audience.languages;
        if (langs.length && !langs.some((l) => b.languages.includes(l))) {
            audience -= 0.4;
            reasons.push(`posts in ${langs.join("/")}, brief wants ${b.languages.join("/")}`);
        }
    }
    audience = Math.max(0, audience);
    // Budget fit: estimated price range vs budget
    const { low, high } = c.analysis.price_per_post;
    const max = b.budget_per_post.max;
    const min = b.budget_per_post.min ?? 0;
    let budget;
    if (low > max) {
        budget = Math.max(0, 1 - (low - max) / max);
        reasons.push(`estimated $${low}-${high} is above budget max $${max}`);
    }
    else if (high < min) {
        budget = 0.7;
        reasons.push(`estimated $${low}-${high} is below budget min $${min} (cheap, but likely smaller reach)`);
    }
    else {
        budget = 1;
        reasons.push(`estimated $${low}-${high} fits budget $${min}-${max}`);
    }
    const score = round(WEIGHTS.niche * niche + WEIGHTS.audience * audience + WEIGHTS.budget * budget, 3);
    return {
        username: c.username,
        score,
        components: { niche: round(niche, 3), audience: round(audience, 3), budget: round(budget, 3) },
        reasons,
        price_per_post: { low, high, currency: c.analysis.price_per_post.currency },
        suggested_offer: Math.min(max, Math.max(min, Math.round((low + high) / 2))),
        followers: c.profile.followers,
        niches: c.analysis.niches.map((n) => n.niche),
    };
}
export function rank(creators, b, limit = 10) {
    const want = briefNiches(b);
    return {
        brief_niches: want,
        weights: WEIGHTS,
        formula: "score = 0.5 x niche_fit + 0.2 x audience_fit + 0.3 x budget_fit (each 0..1)",
        results: creators.map((c) => scoreCreator(c, b, want)).sort((a, z) => z.score - a.score || a.username.localeCompare(z.username)).slice(0, limit),
    };
}
