import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
      DB: {
        prepare() {
          throw new Error("Database should not be used while rendering the app shell");
        },
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Warper Keeper product shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();

  assert.match(html, /<title>Warper Keeper<\/title>/i);
  assert.match(html, /fc:miniapp/i);
  assert.match(html, /warper-social\.png/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("ships a Farcaster manifest with current Mini App fields", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../public/.well-known/farcaster.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(manifest.miniapp.version, "1");
  assert.equal(manifest.miniapp.name, "Warper Keeper");
  assert.equal(
    manifest.miniapp.homeUrl,
    "https://warper-keeper.dreamnet.ink",
  );
  assert.ok(manifest.miniapp.requiredCapabilities.includes("actions.ready"));
  assert.ok(manifest.miniapp.iconUrl.endsWith("/warper-icon.png"));
});
