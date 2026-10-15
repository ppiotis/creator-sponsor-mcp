/**
 * X data source. Three modes:
 *  - x_api:   X_BEARER_TOKEN is set. Read-only GETs to https://api.x.com/2 only. The token is never logged or returned.
 *  - fixture: CREATOR_SPONSOR_FIXTURES points at a local JSON file (offline demos, reviews, tests). No network.
 *  - none:    neither set. Fetching tools explain how to use manual input instead. No network.
 */
import { readFileSync } from "node:fs";
import { UserError } from "./result.js";
export const X_API_BASE = "https://api.x.com/2";
const ALLOWED_HOST = "api.x.com";
const TIMEOUT_MS = 15_000;
/** Token from env; unexpanded placeholders like "${X_BEARER_TOKEN}" count as unset. */
function bearer() {
    const t = process.env.X_BEARER_TOKEN?.trim();
    return t && !/^\$\{.*\}$/.test(t) ? t : undefined;
}
export function sourceMode() {
    if (bearer())
        return "x_api";
    if (process.env.CREATOR_SPONSOR_FIXTURES?.trim())
        return "fixture";
    return "none";
}
const USERNAME = /^[A-Za-z0-9_]{1,15}$/;
export function normUsername(u) {
    const v = u.trim().replace(/^@/, "");
    if (!USERNAME.test(v))
        throw new UserError("Invalid X username (1-15 letters, digits or underscore).");
    return v.toLowerCase();
}
/** Accepts a numeric post id or an x.com / twitter.com status URL. */
export function parsePostRef(ref) {
    const s = ref.trim();
    if (/^\d{1,25}$/.test(s))
        return s;
    let url;
    try {
        url = new URL(s);
    }
    catch {
        throw new UserError("post must be a numeric post id or an https://x.com/<user>/status/<id> URL");
    }
    const host = url.hostname.replace(/^(www\.|mobile\.)/, "");
    if (!["x.com", "twitter.com"].includes(host))
        throw new UserError("Only x.com or twitter.com post URLs are accepted.");
    const m = url.pathname.match(/\/status(?:es)?\/(\d{1,25})/);
    if (!m)
        throw new UserError("Could not find a post id in that URL.");
    return m[1];
}
async function xGet(path, params) {
    const token = bearer();
    if (!token)
        throw new UserError("X_BEARER_TOKEN is not set.");
    const url = new URL(X_API_BASE + path);
    if (url.hostname !== ALLOWED_HOST || url.protocol !== "https:")
        throw new Error("Refusing non-X API host");
    for (const [k, v] of Object.entries(params))
        url.searchParams.set(k, v);
    let res;
    try {
        res = await fetch(url, { method: "GET", headers: { authorization: `Bearer ${token}`, "user-agent": "creator-sponsor-mcp/1.0" }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" });
    }
    catch (e) {
        throw new UserError(`Could not reach the X API (${e instanceof Error ? e.name : "network error"}).`);
    }
    let body = null;
    try {
        body = await res.json();
    }
    catch { /* non-JSON */ }
    if (!res.ok) {
        // Only status and the API's public title/detail are surfaced; headers and request are never echoed.
        const detail = typeof body?.detail === "string" ? body.detail.slice(0, 200) : typeof body?.title === "string" ? body.title.slice(0, 200) : "";
        const hint = res.status === 401 ? " Check X_BEARER_TOKEN." : res.status === 429 ? " Rate limited; try again later." : "";
        throw new UserError(`X API returned ${res.status}${detail ? `: ${detail}` : ""}.${hint}`);
    }
    if (body?.errors?.length && !body.data) {
        throw new UserError(`X API: ${String(body.errors[0]?.detail ?? body.errors[0]?.title ?? "not found").slice(0, 200)}`);
    }
    return body;
}
function mapPost(t, username) {
    const m = t.public_metrics ?? {};
    return {
        id: String(t.id),
        author_id: t.author_id ? String(t.author_id) : undefined,
        author_username: username,
        text: String(t.note_tweet?.text ?? t.text ?? ""),
        created_at: t.created_at,
        likes: Number(m.like_count ?? 0),
        reposts: Number(m.retweet_count ?? 0),
        replies: Number(m.reply_count ?? 0),
        quotes: Number(m.quote_count ?? 0),
        impressions: typeof m.impression_count === "number" ? m.impression_count : null,
        has_media: Boolean(t.attachments?.media_keys?.length),
        urls: (t.entities?.urls ?? t.note_tweet?.entities?.urls ?? []).map((u) => String(u.expanded_url ?? u.url ?? "")).filter(Boolean),
        lang: t.lang,
    };
}
function mapUser(u) {
    const m = u.public_metrics ?? {};
    return {
        id: String(u.id),
        username: String(u.username).toLowerCase(),
        name: u.name,
        description: u.description ?? "",
        location: u.location,
        verified: Boolean(u.verified),
        followers: Number(m.followers_count ?? 0),
        following: Number(m.following_count ?? 0),
        post_count: Number(m.tweet_count ?? 0),
    };
}
function fixtures() {
    const p = process.env.CREATOR_SPONSOR_FIXTURES;
    try {
        return JSON.parse(readFileSync(p, "utf8"));
    }
    catch {
        throw new UserError(`CREATOR_SPONSOR_FIXTURES file could not be read as JSON: ${p}`);
    }
}
const NONE_MSG = "No X data source configured. Either set X_BEARER_TOKEN (read-only X API v2 bearer token) or pass the profile and posts manually (analyze_creator with `manual`).";
export async function fetchCreator(username, maxPosts = 50) {
    const u = normUsername(username);
    const mode = sourceMode();
    if (mode === "fixture") {
        const f = fixtures().users?.[u];
        if (!f)
            throw new UserError(`No fixture for @${u}.`);
        return { source: "fixture", profile: mapUser({ ...f.profile, username: u }), posts: f.posts.slice(0, maxPosts).map((t) => mapPost(t, u)) };
    }
    if (mode === "none")
        throw new UserError(NONE_MSG);
    const user = await xGet(`/users/by/username/${u}`, { "user.fields": "description,location,public_metrics,verified" });
    if (!user?.data?.id)
        throw new UserError(`X user @${u} not found.`);
    const profile = mapUser(user.data);
    const tl = await xGet(`/users/${encodeURIComponent(profile.id)}/tweets`, {
        max_results: String(Math.min(100, Math.max(5, maxPosts))),
        exclude: "replies,retweets",
        "tweet.fields": "created_at,public_metrics,entities,attachments,lang,note_tweet",
    });
    const posts = (tl?.data ?? []).slice(0, maxPosts).map((t) => mapPost(t, profile.username));
    return { source: "x_api", profile, posts };
}
export async function fetchPost(postId) {
    const mode = sourceMode();
    if (mode === "fixture") {
        const t = fixtures().posts?.[postId];
        if (!t)
            throw new UserError(`No fixture for post ${postId}.`);
        return { source: "fixture", post: mapPost({ id: postId, ...t }, t.author_username?.toLowerCase()) };
    }
    if (mode === "none")
        throw new UserError(NONE_MSG.replace("analyze_creator with `manual`", "verify_deal_post with `manual_attestation`"));
    const r = await xGet(`/tweets/${postId}`, { "tweet.fields": "author_id,created_at,entities,note_tweet,public_metrics,attachments,lang", expansions: "author_id", "user.fields": "username" });
    const author = r?.includes?.users?.find((x) => x.id === r.data.author_id);
    return { source: "x_api", post: mapPost(r.data, author?.username?.toLowerCase()) };
}
