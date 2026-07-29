import assert from "node:assert/strict";

const baseUrl =
  process.env.WARPER_KEEPER_URL ?? "https://warper-keeper.dreamnet.ink";
const allowUnsigned = process.argv.includes("--allow-unsigned");
const cacheBust = `preflight=${Date.now()}`;

async function fetchOk(path) {
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(`${baseUrl}${path}${separator}${cacheBust}`);
  assert.equal(response.status, 200, `${path} returned ${response.status}`);
  return response;
}

async function pngDimensions(path) {
  const response = await fetchOk(path);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^image\/png\b/i,
    `${path} is not a PNG`,
  );
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG");
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

const html = await (await fetchOk("/")).text();
assert.match(html, /name="fc:miniapp"/i);
assert.match(html, /name="fc:frame"/i);
assert.match(html, /launch_miniapp/i);
assert.match(html, /\?miniApp=true/i);

const manifest = await (
  await fetchOk("/.well-known/farcaster.json")
).json();
assert.equal(manifest.miniapp?.version, "1");
assert.equal(manifest.miniapp?.name, "Warper Keeper");
assert.equal(
  manifest.miniapp?.homeUrl,
  `${baseUrl}/?miniApp=true`,
);
assert.deepEqual(manifest.miniapp?.requiredCapabilities, ["actions.ready"]);
assert.deepEqual(await pngDimensions("/warper-icon.png"), {
  width: 1024,
  height: 1024,
});
assert.deepEqual(await pngDimensions("/warper-splash.png"), {
  width: 200,
  height: 200,
});
assert.deepEqual(await pngDimensions("/warper-social.png"), {
  width: 1200,
  height: 800,
});
assert.deepEqual(await pngDimensions("/warper-screenshot.png"), {
  width: 1284,
  height: 2778,
});

const signed = Boolean(
  manifest.accountAssociation?.header &&
    manifest.accountAssociation?.payload &&
    manifest.accountAssociation?.signature,
);

if (!signed && !allowUnsigned) {
  throw new Error(
    "Manifest is valid but unsigned. Sign warper-keeper.dreamnet.ink in Farcaster Developer Tools.",
  );
}

console.log(
  JSON.stringify(
    {
      status: signed ? "ready" : "ready_except_account_association",
      url: baseUrl,
      signed,
      sdk: "0.3.0",
      embed: "fc:miniapp + fc:frame",
      assets: {
        icon: "1024x1024",
        splash: "200x200",
        feed: "1200x800",
        screenshot: "1284x2778",
      },
    },
    null,
    2,
  ),
);
