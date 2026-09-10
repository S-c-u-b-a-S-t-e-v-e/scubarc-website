// Deny known sensitive root paths before falling through to static assets.
// Keep _routes.json aligned: ordinary public assets should not invoke this
// middleware. This is defense in depth; secrets must never be deployed.
const privateFiles = new Set([
  "/credentials.json",
  "/service_account.json",
  "/service-account.json",
  "/serviceaccountkey.json",
  "/secrets.json",
  "/token.json",
  "/keys.json",
]);

const privateDirectories = ["/.git", "/.aws", "/.config/gcloud"];

export function onRequest(context) {
  const path = new URL(context.request.url).pathname.toLowerCase();
  const privatePath =
    path === "/.env" ||
    path.startsWith("/.env.") ||
    path.startsWith("/.env/") ||
    privateFiles.has(path) ||
    privateDirectories.some((directory) => path === directory || path.startsWith(`${directory}/`));

  if (privatePath) {
    return new Response(context.request.method === "HEAD" ? null : "Forbidden\n", {
      status: 403,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      },
    });
  }

  return context.next();
}
