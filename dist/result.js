export class UserError extends Error {
}
export function ok(data) {
    return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}
export function fail(message) {
    return { isError: true, content: [{ type: "text", text: `Error: ${message}` }] };
}
/** Wrap a tool implementation so thrown errors become clean MCP tool errors. */
export function safe(fn) {
    return async (args) => {
        try {
            return ok(await fn(args));
        }
        catch (e) {
            if (e instanceof UserError)
                return fail(e.message);
            return fail(e instanceof Error ? e.message : String(e));
        }
    };
}
