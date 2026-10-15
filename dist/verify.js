export const DEFAULT_DISCLOSURES = ["#ad", "#sponsored", "#paidpartnership", "paid partnership"];
const norm = (s) => s.toLowerCase().replace(/\s+/g, " ");
function hasMarker(text, marker) {
    const t = norm(text);
    const m = norm(marker.trim());
    if (m.startsWith("#"))
        return new RegExp(`(^|[^\\w#])${m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`).test(t);
    return t.includes(m);
}
function linkMatches(required, post) {
    const want = required.toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
    const candidates = [...(post.urls ?? []), post.text].map((u) => u.toLowerCase().replace(/https?:\/\//g, ""));
    return candidates.some((c) => c.includes(want));
}
export function checkPost(deal, post, acceptedAt) {
    const checks = [];
    checks.push({
        check: "author",
        pass: post.author_username === deal.creator_username,
        detail: `post author @${post.author_username ?? "unknown"}, deal creator @${deal.creator_username}`,
    });
    for (const phrase of deal.requirement.must_include_phrases) {
        checks.push({ check: `phrase: "${phrase}"`, pass: norm(post.text).includes(norm(phrase)), detail: "case-insensitive match in post text" });
    }
    if (deal.requirement.must_include_link) {
        checks.push({ check: `link: ${deal.requirement.must_include_link}`, pass: linkMatches(deal.requirement.must_include_link, post), detail: "matched against expanded URLs and text" });
    }
    const found = deal.requirement.disclosure.filter((d) => hasMarker(post.text, d));
    checks.push({ check: "disclosure", pass: found.length > 0, detail: found.length ? `found ${found.join(", ")}` : `none of ${deal.requirement.disclosure.join(", ")} found in the post text` });
    if (acceptedAt && post.created_at) {
        checks.push({ check: "posted after acceptance", pass: Date.parse(post.created_at) >= Date.parse(acceptedAt), detail: `posted ${post.created_at}, accepted ${acceptedAt}` });
    }
    return { all_pass: checks.every((c) => c.pass), checks };
}
