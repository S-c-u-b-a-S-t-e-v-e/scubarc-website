import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = new URL("./", import.meta.url);
const source = readFileSync(new URL("functions/_middleware.js", root), "utf8");
const { onRequest } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const routes = JSON.parse(readFileSync(new URL("_routes.json", root), "utf8"));
const matches = (path, pattern) => new RegExp(`^${pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`).test(path);
const invokesFunction = (path) => routes.include.some((pattern) => matches(path, pattern)) &&
  !routes.exclude.some((pattern) => matches(path, pattern));

test("known private paths are routed and denied without reaching assets", async () => {
  for (const path of ["/.env", "/.env.example", "/.env/", "/.git", "/.git/HEAD", "/.aws", "/.aws/credentials", "/.config/gcloud", "/.config/gcloud/credentials.db", "/credentials.json", "/service_account.json", "/service-account.json", "/serviceAccountKey.json", "/serviceaccountkey.json", "/secrets.json", "/token.json", "/keys.json"]) {
    assert.ok(invokesFunction(path), `${path} must invoke the guard`);
    for (const method of ["GET", "HEAD", "POST"]) {
      const response = await onRequest({
        request: new Request(`https://example.test${path}`, { method }),
        next() { assert.fail(`${path} reached the static asset handler`); },
      });
      assert.equal(response.status, 403);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(await response.text(), method === "HEAD" ? "" : "Forbidden\n");
    }
  }
});

test("public pages and scripts remain static, including compute-config.js", async () => {
  const publicPaths = ["/", "/compute-config.js", "/compute.js", "/compute-worker.js", "/style.css", "/compute", "/athena", "/commonwealth/", "/commonwealth/surf/", "/commonwealth/surf/game.html", "/commonwealth/leaderboard/", "/.well-known/security.txt"];
  publicPaths.push(...readdirSync(root).filter((name) => /\.(html|css|js)$/.test(name)).map((name) => `/${name}`));
  for (const path of publicPaths) {
    assert.equal(invokesFunction(path), false, `${path} should stay static`);
    const expected = new Response("public content");
    const response = await onRequest({ request: new Request(`https://example.test${path}`), next: () => expected });
    assert.equal(response, expected);
  }
  for (const path of ["/.github/readme", "/.environment", "/.config/gcloud-example"]) {
    const expected = new Response("not a protected path");
    assert.equal(await onRequest({ request: new Request(`https://example.test${path}`), next: () => expected }), expected);
  }
});

test("all existing compute and game handlers remain reachable with their request bodies", async () => {
  const files = readdirSync(new URL("functions/api/", root), { recursive: true });
  for (const file of files.filter((name) => name.endsWith(".js") && !name.split("/").some((part) => part.startsWith("_")))) {
    const path = `/api/${file.slice(0, -3)}`;
    assert.ok(invokesFunction(path), `${path} must invoke its handler`);
    const request = new Request(`https://example.test${path}`, { method: "POST", body: "unchanged request" });
    const expected = new Response("API response");
    assert.equal(await onRequest({ request, next: () => expected }), expected);
    assert.equal(await request.text(), "unchanged request");
  }
});

test("custom 404 uses existing absolute links and fits Pages route limits", () => {
  const html = readFileSync(new URL("404.html", root), "utf8");
  assert.match(html, /<h1[^>]*>This page is off the map\./);
  assert.match(html, /name="robots" content="noindex"/);
  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
    if (href.startsWith("#")) continue;
    assert.ok(href.startsWith("/"));
    const file = href.endsWith("/") ? `${href}index.html` : href;
    assert.ok(existsSync(fileURLToPath(new URL(file.slice(1), root))), href);
  }
  assert.equal(routes.version, 1);
  assert.ok(routes.include.length + routes.exclude.length <= 100);
  assert.ok([...routes.include, ...routes.exclude].every((pattern) => pattern.startsWith("/") && pattern.length <= 100));
});
