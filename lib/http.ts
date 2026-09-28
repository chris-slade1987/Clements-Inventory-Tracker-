import { NextResponse } from "next/server";

/**
 * Shared API error handling.
 *
 * Two problems this solves across ~90 route handlers:
 *  1. Raw exception text was being returned to the browser (`{ error:
 *     (e as Error).message }`), leaking Prisma/DB internals, table names, and
 *     stack fragments to whoever hit an edge case.
 *  2. Nothing was logged server-side, so a real production error left no trace
 *     beyond whatever the client happened to show.
 *
 * `fail(e)` always logs the full error server-side, then returns a SAFE body:
 *  - Intentional validation errors — a plain `throw new Error("Pick a date")`
 *    or a thrown `HttpError` — pass their message through with their status, so
 *    the helpful user-facing text managers rely on is preserved.
 *  - Unexpected internal errors (Prisma `P####`, Prisma client errors, a
 *    TypeError from a null-deref) are genericized to a 500 with a neutral
 *    message, so internals never reach the client.
 */

/** Throw this for an intentional, user-facing error with a specific status. */
export class HttpError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

const GENERIC = "Something went wrong. Please try again.";

/** True for errors whose message must NOT be shown to the client. */
function isInternalError(e: unknown): boolean {
  const err = e as { code?: unknown; name?: unknown } | null;
  if (!err) return true;
  if (typeof err.code === "string" && /^P\d{4}$/.test(err.code)) return true; // Prisma known-request codes
  if (typeof err.name === "string" && /^Prisma/.test(err.name)) return true; // Prisma client errors
  if (err.name === "TypeError" || err.name === "RangeError" || err.name === "ReferenceError") return true;
  return false;
}

/**
 * Turn a caught error into a safe JSON response. Logs the real error first.
 * @param e the caught error
 * @param status status to use for an intentional (non-internal) error without its own status
 */
export function fail(e: unknown, status = 400): NextResponse {
  console.error("[api]", e);
  if (e instanceof HttpError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  if (isInternalError(e)) {
    return NextResponse.json({ error: GENERIC }, { status: 500 });
  }
  const message = (e as { message?: unknown })?.message;
  return NextResponse.json(
    { error: typeof message === "string" && message ? message : GENERIC },
    { status },
  );
}
