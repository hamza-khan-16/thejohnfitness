// Client-side error reporter
export function reportError(error: unknown, context: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  console.error("[ErrorBoundary]", error, context);
}
