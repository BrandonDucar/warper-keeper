# Warper Keeper

**Catch sources. Build context. Send it ready.**

Warper Keeper is a user-facing DreamNet Mini App for collecting useful material
and turning it into portable Trappers. A Trapper carries a clear objective,
selected sources, provenance, repository snapshots, instructions, and optional
proof so another person or agent can pick up the work without starting over.

[Open Warper Keeper](https://warper-keeper.dreamnet.ink)

![Warper Keeper social card](public/warper-social-wide.png)

## What You Can Do

- Create a Keeper for a project or area of work.
- Personalize its cover line, color system, and stickers.
- Catch notes, links, lightweight files, and public GitHub repositories from the
  main workspace.
- Clone a read-only GitHub snapshot containing the current commit, default
  branch, file manifest, and README excerpt.
- Select source blocks and wrap them in a portable Trapper with a clear next
  objective.
- Share a read-only Trapper link or download the complete bundle as JSON.
- Connect related sources and attach only the context a Trapper needs.
- Build tamper-evident context packs for agent handoffs.
- Close completed work with a deterministic SHA-256 receipt.
- Import or export a complete Keeper as portable JSON.
- Download receipts and proofed context packs as JSON.
- Use the same product in Farcaster or a standard browser.

Outside Farcaster, the current preview stores your workspace on the device.
Inside Farcaster, Quick Auth connects the workspace to a durable D1-backed
account.

## Architecture

```text
Farcaster Mini App or browser
             |
      Warper Keeper UI
             |
   Quick Auth + Cloudflare D1
             |
   Private agent gateway health
             |
   DreamNet agents and receipts
```

The public app never receives a Railway operator token. Farcaster account state
lives in Cloudflare D1, while the private Warper Keeper gateway remains the
bounded integration surface for agent runtimes. Browser preview state stays on
the device.

Public GitHub sources are inspected through GitHub's public API and recorded as
read-only snapshots pinned to their current commit SHA. Warper Keeper does not
run package installation, lifecycle scripts, Git hooks, or imported code.

## Local Development

Requirements: Node.js 22.13 or newer.

```bash
npm install --legacy-peer-deps
npm run dev
```

Validation:

```bash
npm run lint
npm test
```

## Farcaster

The app calls `sdk.actions.ready()` after initialization, publishes an
`fc:miniapp` embed, serves its manifest from
`/.well-known/farcaster.json`, and uses Farcaster Quick Auth for durable
account state.

## Status

Warper Keeper is in public beta. Receipts prove what the app recorded; they do
not independently certify the quality or truth of an agent's result.

## License

Apache-2.0. See [LICENSE](LICENSE).
