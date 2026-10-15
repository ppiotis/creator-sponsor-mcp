/** Deterministic creator analysis: metrics, niche classification and transparent pricing. No LLM, no network. */
/** Niche taxonomy. CPM bands are planning assumptions (USD per 1,000 impressions), not market quotes. */
export const NICHES = {
    ai_tech: { label: "AI & tech", keywords: ["ai", "llm", "gpt", "grok", "model", "agent", "agents", "code", "coding", "developer", "software", "startup", "tech", "api", "open source", "robot", "robots", "automation", "saas", "app", "cursor", "javascript", "python", "typescript", "gpu"], cpm_usd: [12, 25], products: ["developer tools", "SaaS", "AI apps", "hardware & gadgets", "online courses (tech)"], audience: "builders, developers and early adopters" },
    finance: { label: "Finance & investing", keywords: ["stock", "stocks", "invest", "investing", "market", "markets", "crypto", "bitcoin", "btc", "eth", "trading", "portfolio", "dividend", "fed", "inflation", "money", "wealth", "etf", "earnings"], cpm_usd: [15, 30], products: ["fintech apps", "brokerages", "newsletters", "personal finance tools"], audience: "retail investors and finance-curious professionals" },
    business: { label: "Business & entrepreneurship", keywords: ["business", "founder", "founders", "entrepreneur", "marketing", "sales", "revenue", "mrr", "growth", "customers", "solopreneur", "side hustle", "brand", "ecommerce", "etsy", "shopify", "freelance", "agency"], cpm_usd: [10, 22], products: ["B2B SaaS", "productivity tools", "ecommerce tools", "business courses"], audience: "founders, solopreneurs and marketers" },
    space_science: { label: "Space & science", keywords: ["space", "spacex", "mars", "rocket", "rockets", "starship", "launch", "nasa", "orbit", "physics", "science", "astronomy", "tesla", "ev", "energy"], cpm_usd: [8, 18], products: ["science gadgets", "EV accessories", "education", "telescopes & hobby kits"], audience: "science and space enthusiasts" },
    gaming: { label: "Gaming", keywords: ["game", "games", "gaming", "gamer", "steam", "xbox", "playstation", "nintendo", "esports", "twitch", "fps", "rpg", "speedrun"], cpm_usd: [5, 12], products: ["games", "gaming peripherals", "energy drinks", "streaming gear"], audience: "gamers, mostly 16-34" },
    fitness_health: { label: "Fitness & health", keywords: ["fitness", "gym", "workout", "training", "protein", "health", "nutrition", "diet", "running", "marathon", "sleep", "lifting", "yoga", "wellness"], cpm_usd: [7, 15], products: ["supplements", "fitness apps", "athletic apparel", "wearables"], audience: "health-conscious adults" },
    lifestyle: { label: "Lifestyle, fashion & travel", keywords: ["travel", "fashion", "style", "outfit", "food", "recipe", "coffee", "home", "decor", "family", "parenting", "beauty", "skincare", "wedding"], cpm_usd: [6, 14], products: ["fashion & beauty", "travel", "home goods", "food & beverage"], audience: "lifestyle-oriented consumers" },
    creative: { label: "Art, design & creators", keywords: ["art", "design", "designer", "illustration", "photo", "photography", "video", "film", "music", "3d", "animation", "midjourney", "imagine", "creator", "creators", "youtube", "digital art", "printable", "printables"], cpm_usd: [6, 15], products: ["creative software", "camera & audio gear", "digital products", "creator tools"], audience: "creatives and aspiring creators" },
    news_politics: { label: "News & commentary", keywords: ["breaking", "news", "election", "policy", "government", "politics", "senate", "congress", "president", "law", "court"], cpm_usd: [4, 10], products: ["news subscriptions", "VPNs", "books"], audience: "news-engaged adults" },
};
export const GENERAL = { label: "General", keywords: [], cpm_usd: [4, 10], products: ["broad consumer products"], audience: "general audience" };
export const ASSUMPTIONS = {
    reach_rate_without_impressions: 0.05, // expected impressions = followers x 5% when posts carry no impression counts
    engagement_benchmark: 0.01, // 1% engagement rate = multiplier 1.0
    multiplier_bounds: [0.5, 2.0],
    sponsored_discount: 0.8, // sponsored posts typically reach ~80% of an organic median post
};
function tokens(text) {
    return text.toLowerCase().replace(/https?:\/\/\S+/g, " ").match(/[a-z0-9$#@][a-z0-9'-]*/g)?.map((t) => t.replace(/^[#$]/, "")) ?? [];
}
/** Score text against each niche. Multi-word keywords match as phrases. Returns raw hit counts. */
export function nicheHits(texts) {
    const hits = {};
    for (const [key, def] of Object.entries(NICHES))
        hits[key] = 0;
    for (const text of texts) {
        const toks = new Set(tokens(text));
        const lower = ` ${text.toLowerCase().replace(/[^a-z0-9 ]/g, " ")} `;
        for (const [key, def] of Object.entries(NICHES)) {
            for (const kw of def.keywords) {
                if (kw.includes(" ") ? lower.includes(` ${kw} `) : toks.has(kw))
                    hits[key] += 1;
            }
        }
    }
    return hits;
}
/** Normalised niche shares (sum to 1), top entries only. Empty array when no signal. */
export function classify(texts, max = 3) {
    const hits = nicheHits(texts);
    const total = Object.values(hits).reduce((a, b) => a + b, 0);
    if (total === 0)
        return [];
    return Object.entries(hits)
        .filter(([, h]) => h > 0)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, max)
        .map(([niche, h]) => ({ niche, label: NICHES[niche].label, share: round(h / total, 3), hits: h }));
}
export const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const median = (xs) => {
    if (!xs.length)
        return 0;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export function engagementMetrics(profile, posts) {
    const n = posts.length;
    const sum = (f) => posts.reduce((a, p) => a + f(p), 0);
    const avg = (f) => (n ? round(sum(f) / n, 1) : 0);
    const withImp = posts.filter((p) => typeof p.impressions === "number" && p.impressions > 0);
    const interactions = (p) => p.likes + p.reposts + p.replies + p.quotes;
    const er_by_impressions = withImp.length ? round(withImp.reduce((a, p) => a + interactions(p), 0) / withImp.reduce((a, p) => a + p.impressions, 0), 4) : null;
    const er_by_followers = n && profile.followers > 0 ? round(sum(interactions) / n / profile.followers, 4) : null;
    const dates = posts.map((p) => (p.created_at ? Date.parse(p.created_at) : NaN)).filter(Number.isFinite).sort((a, b) => a - b);
    const spanDays = dates.length > 1 ? (dates[dates.length - 1] - dates[0]) / 86_400_000 : 0;
    return {
        posts_analyzed: n,
        avg_likes: avg((p) => p.likes),
        avg_reposts: avg((p) => p.reposts),
        avg_replies: avg((p) => p.replies),
        avg_quotes: avg((p) => p.quotes),
        median_impressions: withImp.length ? median(withImp.map((p) => p.impressions)) : null,
        posts_with_impressions: withImp.length,
        engagement_rate: er_by_impressions ?? er_by_followers ?? 0,
        engagement_rate_basis: er_by_impressions !== null ? "interactions / impressions" : "avg interactions per post / followers",
        engagement_rate_by_followers: er_by_followers,
        posts_per_week: spanDays >= 1 ? round((dates.length - 1) / (spanDays / 7), 1) : null,
    };
}
export function contentStyle(posts) {
    const n = posts.length || 1;
    const share = (f) => round(posts.filter(f).length / n, 2);
    const langs = {};
    for (const p of posts)
        if (p.lang)
            langs[p.lang] = (langs[p.lang] ?? 0) + 1;
    return {
        avg_length_chars: posts.length ? Math.round(posts.reduce((a, p) => a + p.text.length, 0) / posts.length) : 0,
        media_share: share((p) => Boolean(p.has_media)),
        link_share: share((p) => (p.urls?.length ?? 0) > 0 || /https?:\/\//.test(p.text)),
        question_share: share((p) => p.text.includes("?")),
        hashtag_share: share((p) => /(^|\s)#\w/.test(p.text)),
        thread_like_share: share((p) => /(^|\s)(\d+\/\d*|🧵|thread)/i.test(p.text)),
        top_languages: Object.entries(langs).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([lang, c]) => ({ lang, share: round(c / n, 2) })),
    };
}
export function priceEstimate(profile, metrics, primaryNiche) {
    const def = primaryNiche ? NICHES[primaryNiche] : GENERAL;
    const a = ASSUMPTIONS;
    const baseImpressions = metrics.median_impressions ?? profile.followers * a.reach_rate_without_impressions;
    const expected_impressions = Math.round(baseImpressions * a.sponsored_discount);
    const rawMult = metrics.engagement_rate / a.engagement_benchmark;
    const multiplier = round(Math.min(a.multiplier_bounds[1], Math.max(a.multiplier_bounds[0], Math.sqrt(rawMult))), 2);
    const price = (cpm) => Math.round((expected_impressions / 1000) * cpm * multiplier);
    return {
        currency: "USD",
        low: price(def.cpm_usd[0]),
        high: price(def.cpm_usd[1]),
        formula: "price = (expected_impressions / 1000) x CPM x engagement_multiplier",
        inputs: {
            niche_used: primaryNiche ?? "general",
            cpm_band_usd: def.cpm_usd,
            expected_impressions,
            expected_impressions_basis: metrics.median_impressions !== null
                ? `median impressions of ${metrics.posts_with_impressions} recent posts (${metrics.median_impressions}) x sponsored discount ${a.sponsored_discount}`
                : `followers (${profile.followers}) x assumed reach rate ${a.reach_rate_without_impressions} x sponsored discount ${a.sponsored_discount}`,
            engagement_rate: metrics.engagement_rate,
            engagement_multiplier: multiplier,
            engagement_multiplier_basis: `sqrt(engagement_rate / ${a.engagement_benchmark} benchmark), clamped to [${a.multiplier_bounds.join(", ")}]`,
        },
        assumptions: [
            "CPM bands are planning assumptions per niche, not market quotes. Treat the range as a starting point for negotiation.",
            "Impression counts come from the X API public metrics when available; otherwise reach is estimated from followers.",
            "Engagement is computed only from the recent original posts analysed (replies and reposts excluded).",
            "Does not account for exclusivity, usage rights, multiple posts, video production or audience geography.",
        ],
    };
}
export function analyze(profile, posts) {
    const texts = [profile.description ?? "", profile.description ?? "", ...posts.map((p) => p.text)]; // bio counted twice: it is a strong signal
    const niches = classify(texts);
    const engagement = engagementMetrics(profile, posts);
    const style = contentStyle(posts);
    const primary = niches[0]?.niche ?? null;
    const products = [...new Set(niches.flatMap((n) => NICHES[n.niche].products))].slice(0, 8);
    const quality = [];
    if (posts.length < 10)
        quality.push(`Only ${posts.length} posts analysed; metrics are low-confidence (aim for 20+).`);
    if (!niches.length)
        quality.push("No niche keywords found; classified as General.");
    if (engagement.median_impressions === null)
        quality.push("No impression counts available; reach is estimated from followers.");
    return {
        niches,
        audience: {
            summary: primary ? NICHES[primary].audience : GENERAL.audience,
            followers: profile.followers,
            following: profile.following,
            follower_ratio: profile.following ? round(profile.followers / profile.following, 1) : null,
            location: profile.location,
            languages: style.top_languages.map((l) => l.lang),
            verified: Boolean(profile.verified),
        },
        content_style: style,
        engagement,
        best_fit_product_categories: products.length ? products : GENERAL.products,
        price_per_post: priceEstimate(profile, engagement, primary),
        data_quality: quality,
    };
}
/** Prompt the calling agent can use to write the human-readable summary. The server never calls an LLM. */
export function narrativePrompt(username, a) {
    return [
        `Write a 3-4 sentence sponsor-facing summary of X creator @${username} using ONLY the structured analysis below.`,
        "Cover: niche(s), who the audience is, content style, best-fit product categories, and the price-per-post range with its basis.",
        "Do not invent numbers. Say the price is an estimate from the shown formula. Mention any data_quality caveats.",
        JSON.stringify({ niches: a.niches, audience: a.audience, content_style: a.content_style, engagement: a.engagement, best_fit_product_categories: a.best_fit_product_categories, price_per_post: { low: a.price_per_post.low, high: a.price_per_post.high, currency: a.price_per_post.currency, formula: a.price_per_post.formula }, data_quality: a.data_quality }),
    ].join("\n");
}
