import assert from "node:assert/strict";
import { open, readFile } from "node:fs/promises";
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
  assert.match(html, /fc:frame/i);
  assert.match(html, /launch_miniapp/i);
  assert.match(html, /launch_frame/i);
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
    "https://warper-keeper.dreamnet.ink/?miniApp=true",
  );
  assert.ok(manifest.miniapp.requiredCapabilities.includes("actions.ready"));
  assert.deepEqual(manifest.miniapp.requiredCapabilities, ["actions.ready"]);
  assert.ok(manifest.miniapp.iconUrl.endsWith("/warper-icon.png"));
  assert.ok(manifest.miniapp.imageUrl.endsWith("/warper-social.png"));
  assert.ok(manifest.miniapp.splashImageUrl.endsWith("/warper-splash.png"));
  assert.ok(manifest.miniapp.screenshotUrls[0].endsWith("/warper-screenshot.png"));
  assert.equal(manifest.miniapp.buttonTitle, "Open Warper Keeper");
  assert.equal(
    manifest.miniapp.canonicalDomain,
    "warper-keeper.dreamnet.ink",
  );
});

test("ships Farcaster-compatible PNG dimensions", async () => {
  async function pngDimensions(file) {
    const handle = await open(file, "r");
    try {
      const header = Buffer.alloc(24);
      await handle.read(header, 0, header.length, 0);
      assert.equal(header.subarray(1, 4).toString("ascii"), "PNG");
      return {
        width: header.readUInt32BE(16),
        height: header.readUInt32BE(20),
      };
    } finally {
      await handle.close();
    }
  }

  assert.deepEqual(
    await pngDimensions(
      new URL("../public/warper-social.png", import.meta.url),
    ),
    { width: 1200, height: 800 },
  );
  assert.deepEqual(
    await pngDimensions(
      new URL("../public/warper-icon.png", import.meta.url),
    ),
    { width: 1024, height: 1024 },
  );
  assert.deepEqual(
    await pngDimensions(
      new URL("../public/warper-splash.png", import.meta.url),
    ),
    { width: 200, height: 200 },
  );
  assert.deepEqual(
    await pngDimensions(
      new URL("../public/warper-screenshot.png", import.meta.url),
    ),
    { width: 1284, height: 2778 },
  );
});

test("releases the Farcaster splash before optional cloud hydration", async () => {
  const app = await readFile(
    new URL("../app/warper-keeper-app.tsx", import.meta.url),
    "utf8",
  );
  const readyCall = app.indexOf("await within(sdk.actions.ready())");
  const cloudHydration = app.indexOf(
    'await sdk.quickAuth.fetch("/api/miniapp/state")',
  );

  assert.ok(readyCall >= 0);
  assert.ok(cloudHydration >= 0);
  assert.ok(readyCall < cloudHydration);
  assert.match(app, /sdk\.getCapabilities\(\)/);
  assert.match(app, /sdk\.actions\.addMiniApp\(\)/);
  assert.match(app, /Farcaster host did not respond in time/);
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

test("ships the portable Trapper exchange schema and source-first workspace", async () => {
  const exchangeMigration = await readFile(
    new URL("../drizzle/0003_dusty_supernaut.sql", import.meta.url),
    "utf8",
  );
  const workspace = await readFile(
    new URL("../app/keeper-workspace.tsx", import.meta.url),
    "utf8",
  );
  const exchangeIndexes = await readFile(
    new URL("../drizzle/0004_daffy_leper_queen.sql", import.meta.url),
    "utf8",
  );

  assert.match(exchangeMigration, /CREATE TABLE `trapper_sources`/);
  assert.match(exchangeMigration, /CREATE TABLE `trapper_shares`/);
  assert.match(exchangeMigration, /ADD `snapshot_json`/);
  assert.match(exchangeIndexes, /UNIQUE INDEX `trapper_sources_pair_unique`/);
  assert.match(workspace, /SOURCE-POWERED WORKSPACE/);
  assert.match(workspace, /Clone GitHub/);
  assert.match(workspace, /Build Trapper/);
});

test("emits contract-complete bundles with canonical receipt hashes", async () => {
  const worker = await readFile(
    new URL("../worker/index.ts", import.meta.url),
    "utf8",
  );
  const app = await readFile(
    new URL("../app/warper-keeper-app.tsx", import.meta.url),
    "utf8",
  );

  assert.match(worker, /const hash = await sha256Value\(payload\)/);
  assert.match(worker, /schemaVersion: 1/);
  assert.match(worker, /privacyClassification: "private"/);
  assert.match(worker, /closedAt: trapper\.closed_at \? String\(trapper\.closed_at\) : null/);
  assert.match(app, /closedAt: trapper\.closedAt \?\? null/);
  assert.match(app, /maxSourceBytes: 1_048_576/);
});

test("ships a public Cloudflare runtime without the ChatGPT access gate", async () => {
  const config = JSON.parse(
    await readFile(
      new URL("../wrangler.public.jsonc", import.meta.url),
      "utf8",
    ),
  );

  assert.equal(config.name, "warper-keeper");
  assert.equal(config.workers_dev, true);
  assert.equal(config.d1_databases[0].binding, "DB");
  assert.equal(config.routes[0].pattern, "warper-keeper.dreamnet.ink");
  assert.equal(config.routes[0].custom_domain, true);
});
