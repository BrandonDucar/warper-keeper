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
  assert.match(html, /src="\/warper-icon\.png"/i);
  assert.doesNotMatch(html, /_vinext\/image\?url=%2Fwarper-icon/i);
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

test("ships additive D1 migrations for the library and personalization", async () => {
  const libraryMigration = await readFile(
    new URL("../drizzle/0001_productive_chameleon.sql", import.meta.url),
    "utf8",
  );
  const personalizationMigration = await readFile(
    new URL("../drizzle/0002_robust_joystick.sql", import.meta.url),
    "utf8",
  );

  assert.match(libraryMigration, /CREATE TABLE `sources`/);
  assert.match(libraryMigration, /CREATE TABLE `proof_drops`/);
  assert.match(personalizationMigration, /CREATE TABLE `keeper_personalization`/);
  assert.match(personalizationMigration, /owner_fid_unique/);
});
