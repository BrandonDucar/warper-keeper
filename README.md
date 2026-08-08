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
- Delegate selected Keepers to an external AI with finite permissions, expiry,
  token rotation, revocation, idempotent writes, and receipt-backed audit.

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
   D1 Agent Delegation ACL
             |
 Direct token or Spore identity
             |
   bounded agent API + receipts
```

The public app never receives an infrastructure operator token. Farcaster
account state and agent grants live in Cloudflare D1. Direct BYO-AI tokens and
trusted Spore assertions resolve to the same default-deny authorization model.
Browser preview state stays on the device.

See [Agent Delegation v1](docs/agent-delegation.md) for the grant schema, route
contract, Spore assertion format, receipt boundary, and deployment gate.

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
account state. It capability-checks optional host actions before exposing them
and lets supported clients save the app with `actions.addMiniApp()`.

The production manifest still needs an `accountAssociation` signed for the
exact `warper-keeper.dreamnet.ink` domain in Farcaster Developer Tools before
the app can be treated as owner-verified in discovery.

## Status

Warper Keeper is in public beta. Receipts prove what the app recorded; they do
not independently certify the quality or truth of an agent's result.

## License

Apache-2.0. See [LICENSE](LICENSE).
