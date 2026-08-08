import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AGENT_PERMISSIONS,
  assertKeeperAccess,
  assertPermission,
  createAgentToken,
  hashAgentToken,
  hmacSha256Hex,
  normalizeAgentGrant,
  normalizeGrantRenewal,
  parseGrantRow,
  sha256Hex,
  sporeAssertionMessage,
  validateSporeAssertionWindow,
  verifySporeAssertion,
} from "../worker/agent-delegation.mjs";

const now = new Date("2026-08-08T12:00:00.000Z");

test("agent grants are finite, explicit, normalized, and owner-scoped", () => {
  const grant = normalizeAgentGrant(
    {
      tenantId: "Gundarium",
      agentId: "Larry",
      keeperIds: ["launch", "launch"],
      permissions: ["trapper:read", "keeper:read", "trapper:read"],
      expiresAt: "2026-09-07T12:00:00.000Z",
    },
    ["launch", "private"],
    now,
  );
  assert.deepEqual(grant, {
    tenantId: "gundarium",
    agentId: "larry",
    keeperIds: ["launch"],
    permissions: ["keeper:read", "trapper:read"],
    expiresAt: "2026-09-07T12:00:00.000Z",
  });
});

test("grant input rejects unknown authority, unknown fields, and unowned keepers", () => {
  assert.throws(
    () =>
      normalizeAgentGrant(
        {
          tenantId: "gundarium",
          agentId: "larry",
          keeperIds: ["launch"],
          permissions: ["proof:certify"],
        },
        ["launch"],
        now,
      ),
    /AGENT_GRANT_PERMISSION_UNKNOWN/,
  );
  assert.throws(
    () =>
      normalizeAgentGrant(
        {
          tenantId: "gundarium",
          agentId: "larry",
          keeperIds: ["another-owner"],
          permissions: ["keeper:read"],
        },
        ["launch"],
        now,
      ),
    /AGENT_GRANT_KEEPER_NOT_OWNED/,
  );
  assert.throws(
    () =>
      normalizeAgentGrant(
        {
          tenantId: "gundarium",
          agentId: "larry",
          keeperIds: ["launch"],
          permissions: ["keeper:read"],
          denied: ["proof:certify"],
        },
        ["launch"],
        now,
      ),
    /AGENT_GRANT_UNKNOWN_FIELD:denied/,
  );
});

test("grant expiry and renewal stay within bounded renewable windows", () => {
  assert.throws(
    () =>
      normalizeAgentGrant(
        {
          tenantId: "gundarium",
          agentId: "larry",
          keeperIds: ["launch"],
          permissions: ["keeper:read"],
          expiresAt: null,
        },
        ["launch"],
        now,
      ),
    /AGENT_GRANT_EXPIRY_/,
  );
  assert.equal(
    normalizeGrantRenewal({ expiresAt: "2026-08-15T12:00:00.000Z" }, now),
    "2026-08-15T12:00:00.000Z",
  );
  assert.throws(
    () => normalizeGrantRenewal({ expiresAt: "2027-08-08T12:00:00.000Z" }, now),
    /AGENT_GRANT_EXPIRY_OUT_OF_BOUNDS/,
  );
});

test("direct credentials are random bearer values and only stable as hashes", async () => {
  const first = createAgentToken();
  const second = createAgentToken();
  assert.match(first, /^wk_agent_[A-Za-z0-9_-]{40,}$/);
  assert.notEqual(first, second);
  assert.match(await hashAgentToken(first), /^[a-f0-9]{64}$/);
  await assert.rejects(() => hashAgentToken("not-a-warper-token"), /AGENT_TOKEN_INVALID/);
});

test("stored grants fail closed after revocation or expiry", () => {
  const base = {
    id: "grant-1234",
    owner_fid: 123456,
    tenant_id: "gundarium",
    agent_id: "larry",
    keeper_ids_json: '["launch"]',
    permissions_json: '["keeper:read","trapper:read"]',
    issued_at: "2026-08-01T12:00:00.000Z",
    expires_at: "2026-08-09T12:00:00.000Z",
    revoked_at: null,
  };
  const active = parseGrantRow(base, now);
  assert.equal(active.active, true);
  assert.equal(active.ownerId, "fid:123456");
  assert.doesNotThrow(() => assertPermission(active, "keeper:read"));
  assert.doesNotThrow(() => assertKeeperAccess(active, "launch"));
  assert.throws(() => assertPermission(active, "source:add"), /AGENT_PERMISSION_DENIED/);
  assert.throws(() => assertKeeperAccess(active, "private"), /AGENT_KEEPER_DENIED/);
  assert.equal(parseGrantRow({ ...base, revoked_at: now.toISOString() }, now).active, false);
  assert.equal(
    parseGrantRow({ ...base, expires_at: "2026-08-08T11:59:59.000Z" }, now).active,
    false,
  );
  assert.deepEqual([...AGENT_PERMISSIONS].sort(), AGENT_PERMISSIONS);
});

test("Spore assertions bind identity, lease, route, body, and a short validity window", async () => {
  const secret = "test-only-spore-secret-that-is-long-enough";
  const request = new Request("https://keeper.example/api/agent/keepers?limit=5", {
    method: "POST",
    body: '{"query":"launch"}',
  });
  const assertion = {
    grantId: "grant-1234",
    tenantId: "gundarium",
    agentId: "larry",
    leaseId: "lease-1234",
    issuedAt: "2026-08-08T11:59:30.000Z",
    expiresAt: "2026-08-08T12:02:30.000Z",
    requestId: "request-1234",
    signature: "",
  };
  const bodyHash = await sha256Hex('{"query":"launch"}');
  assertion.signature = await hmacSha256Hex(
    secret,
    sporeAssertionMessage({ request, assertion, bodyHash }),
  );
  await assert.doesNotReject(() =>
    verifySporeAssertion({ request, assertion, bodyHash, secret, now }),
  );
  await assert.rejects(
    () =>
      verifySporeAssertion({
        request,
        assertion: { ...assertion, tenantId: "another-tenant" },
        bodyHash,
        secret,
        now,
      }),
    /SPORE_ASSERTION_SIGNATURE_INVALID/,
  );
  assert.throws(
    () =>
      validateSporeAssertionWindow(
        { ...assertion, expiresAt: "2026-08-08T12:10:00.000Z" },
        now,
      ),
    /SPORE_ASSERTION_EXPIRED/,
  );
});

test("the additive migration and worker ship the durable boundary without a Railway hard-code", async () => {
  const migration = await readFile(
    new URL("../drizzle/0005_square_luke_cage.sql", import.meta.url),
    "utf8",
  );
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const documentation = await readFile(
    new URL("../docs/agent-delegation.md", import.meta.url),
    "utf8",
  );
  assert.match(migration, /CREATE TABLE `agent_grants`/);
  assert.match(migration, /CREATE TABLE `agent_tokens`/);
  assert.match(migration, /CREATE TABLE `agent_spore_nonces`/);
  assert.match(migration, /agent_receipts_idempotency_unique/);
  assert.match(migration, /agent_grant_events_idempotency_unique/);
  assert.doesNotMatch(worker, /up\.railway\.app/);
  assert.match(documentation, /Spore proves the caller identity and lease/);
  assert.match(documentation, /certification: \"none\"/);
});
