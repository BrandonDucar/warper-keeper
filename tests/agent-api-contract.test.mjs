import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  handleAgentApi,
  handleOwnerAgentGrantApi,
} from "../worker/agent-api.ts";
import {
  hmacSha256Hex,
  sha256Hex,
  sporeAssertionMessage,
} from "../worker/agent-delegation.mjs";

class PreparedStatement {
  constructor(database, sql, bindings = []) {
    this.database = database;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new PreparedStatement(this.database, this.sql, bindings);
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.bindings) ?? null;
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.bindings) };
  }

  async run() {
    return this.database.prepare(this.sql).run(...this.bindings);
  }
}

class TestD1 {
  constructor() {
    this.database = new DatabaseSync(":memory:");
  }

  prepare(sql) {
    return new PreparedStatement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  exec(sql) {
    this.database.exec(sql);
  }

  get(sql, ...bindings) {
    return this.database.prepare(sql).get(...bindings);
  }

  close() {
    this.database.close();
  }
}

function baseSchema(db) {
  db.exec(`
    CREATE TABLE keepers (
      id TEXT PRIMARY KEY, owner_fid INTEGER NOT NULL, name TEXT NOT NULL,
      template TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE trappers (
      id TEXT PRIMARY KEY, keeper_id TEXT NOT NULL, owner_fid INTEGER NOT NULL,
      title TEXT NOT NULL, objective TEXT NOT NULL, risk_level TEXT NOT NULL,
      status TEXT NOT NULL, context_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, closed_at TEXT
    );
    CREATE TABLE context_items (
      id TEXT PRIMARY KEY, trapper_id TEXT NOT NULL, owner_fid INTEGER NOT NULL,
      content TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE sources (
      id TEXT PRIMARY KEY, keeper_id TEXT NOT NULL, owner_fid INTEGER NOT NULL,
      kind TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, url TEXT,
      commit_sha TEXT, snapshot_json TEXT, file_name TEXT, mime_type TEXT,
      content_excerpt TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE trapper_sources (
      id TEXT PRIMARY KEY, trapper_id TEXT NOT NULL, source_id TEXT NOT NULL,
      owner_fid INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE receipts (
      id TEXT PRIMARY KEY, trapper_id TEXT NOT NULL, owner_fid INTEGER NOT NULL,
      hash TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);
}

async function responseJson(response) {
  return { status: response.status, body: await response.json() };
}

test("Drizzle delegation migrations apply cleanly with every required index", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    const migration = await readFile(
      new URL("../drizzle/0005_square_luke_cage.sql", import.meta.url),
      "utf8",
    );
    database.exec(migration.replaceAll("--> statement-breakpoint", ""));
    const names = database
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index') ORDER BY name")
      .all()
      .map((row) => row.name);
    for (const required of [
      "agent_grants",
      "agent_tokens",
      "agent_spore_nonces",
      "agent_artifacts",
      "agent_receipts",
      "agent_rate_limits",
      "agent_grant_events_idempotency_unique",
      "agent_receipts_idempotency_unique",
    ]) {
      assert.ok(names.includes(required), `missing ${required}`);
    }
  } finally {
    database.close();
  }
});

test("owner grants and delegated agent writes share one fail-closed D1 authorization model", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  baseSchema(db);
  db.exec(`
    INSERT INTO keepers VALUES (
      'gundarium-launch', 123456, 'GundariuM', 'project',
      '2026-08-08T12:00:00.000Z', '2026-08-08T12:00:00.000Z'
    );
    INSERT INTO keepers VALUES (
      'private-keeper', 999999, 'Private', 'project',
      '2026-08-08T12:00:00.000Z', '2026-08-08T12:00:00.000Z'
    );
    INSERT INTO trappers VALUES (
      'launch-trapper', 'gundarium-launch', 123456, 'Launch', 'Prepare launch',
      'low', 'open', 0, '2026-08-08T12:00:00.000Z', NULL
    );
  `);
  const env = {
    DB: db,
    SPORE_GATEWAY_HMAC_SECRET: "test-only-spore-secret-that-is-long-enough",
  };

  const issued = await responseJson(
    await handleOwnerAgentGrantApi(
      new Request("https://keeper.example/api/miniapp/agent-grants", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "owner-grant-0001",
        },
        body: JSON.stringify({
          tenantId: "gundarium",
          agentId: "larry",
          keeperIds: ["gundarium-launch"],
          permissions: [
            "keeper:read",
            "trapper:read",
            "trapper:write",
            "receipt:create",
          ],
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          issueDirectToken: true,
        }),
      }),
      env,
      123456,
    ),
  );
  assert.equal(issued.status, 201);
  assert.match(issued.body.directToken, /^wk_agent_/);
  assert.equal(issued.body.grant.ownerId, "fid:123456");
  assert.equal(issued.body.receipt.action, "issued");
  assert.equal(issued.body.grant.revokedAt, null);

  const duplicateGrant = await responseJson(
    await handleOwnerAgentGrantApi(
      new Request("https://keeper.example/api/miniapp/agent-grants", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "owner-grant-0001",
        },
        body: JSON.stringify({
          tenantId: "gundarium",
          agentId: "larry",
          keeperIds: ["gundarium-launch"],
          permissions: ["keeper:read"],
        }),
      }),
      env,
      123456,
    ),
  );
  assert.equal(duplicateGrant.status, 409);
  assert.match(duplicateGrant.body.error, /^AGENT_GRANT_OPERATION_ALREADY_APPLIED:/);
  assert.equal(db.get("SELECT COUNT(*) AS count FROM agent_grants").count, 1);

  const stored = db.get("SELECT token_hash FROM agent_tokens LIMIT 1");
  assert.match(stored.token_hash, /^[a-f0-9]{64}$/);
  assert.notEqual(stored.token_hash, issued.body.directToken);
  const auth = { authorization: `Bearer ${issued.body.directToken}` };

  const keepers = await responseJson(
    await handleAgentApi(
      new Request("https://keeper.example/api/agent/keepers", { headers: auth }),
      env,
    ),
  );
  assert.equal(keepers.status, 200);
  assert.deepEqual(keepers.body.keepers.map((keeper) => keeper.id), ["gundarium-launch"]);

  const writeRequest = () =>
    new Request("https://keeper.example/api/agent/trappers/launch-trapper/context", {
      method: "POST",
      headers: {
        ...auth,
        "content-type": "application/json",
        "idempotency-key": "larry-context-0001",
      },
      body: JSON.stringify({ content: "PvP resolver needs one more deterministic replay." }),
    });
  const firstWrite = await responseJson(await handleAgentApi(writeRequest(), env));
  assert.equal(firstWrite.status, 201);
  assert.equal(firstWrite.body.receipt.certification, "none");
  assert.equal(firstWrite.body.receipt.authMode, "direct");
  const replay = await responseJson(await handleAgentApi(writeRequest(), env));
  assert.equal(replay.status, 200);
  assert.equal(replay.body.idempotentReplay, true);
  assert.equal(db.get("SELECT COUNT(*) AS count FROM context_items").count, 1);
  assert.equal(db.get("SELECT context_count FROM trappers WHERE id = 'launch-trapper'").context_count, 1);

  const deniedSource = await responseJson(
    await handleAgentApi(
      new Request("https://keeper.example/api/agent/sources", {
        method: "POST",
        headers: {
          ...auth,
          "content-type": "application/json",
          "idempotency-key": "larry-source-0001",
        },
        body: JSON.stringify({
          keeperId: "gundarium-launch",
          kind: "note",
          title: "Denied",
          summary: "Larry was not granted source:add.",
        }),
      }),
      env,
    ),
  );
  assert.equal(deniedSource.status, 403);
  assert.equal(deniedSource.body.error, "AGENT_PERMISSION_DENIED");

  const selfCertification = await responseJson(
    await handleAgentApi(
      new Request("https://keeper.example/api/agent/trappers/launch-trapper/receipts", {
        method: "POST",
        headers: {
          ...auth,
          "content-type": "application/json",
          "idempotency-key": "larry-receipt-0001",
        },
        body: JSON.stringify({
          status: "completed",
          summary: "I certify my own competency.",
          evidenceRefs: [],
          selfAttested: true,
          verdict: "PASSED",
        }),
      }),
      env,
    ),
  );
  assert.equal(selfCertification.status, 400);
  assert.equal(selfCertification.body.error, "AGENT_UNKNOWN_FIELD:verdict");

  const resultReceipt = await responseJson(
    await handleAgentApi(
      new Request("https://keeper.example/api/agent/trappers/launch-trapper/receipts", {
        method: "POST",
        headers: {
          ...auth,
          "content-type": "application/json",
          "idempotency-key": "larry-receipt-0002",
        },
        body: JSON.stringify({
          status: "completed",
          summary: "Replay passed locally; independent verification remains required.",
          evidenceRefs: ["sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
          selfAttested: true,
        }),
      }),
      env,
    ),
  );
  assert.equal(resultReceipt.status, 201);
  assert.equal(resultReceipt.body.result.certification, "none");
  assert.equal(db.get("SELECT COUNT(*) AS count FROM receipts").count, 1);

  const sporeRequest = new Request("https://keeper.example/api/agent/session");
  const issuedAt = new Date(Date.now() - 1_000).toISOString();
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const sporeAssertion = {
    grantId: issued.body.grant.grantId,
    tenantId: "gundarium",
    agentId: "larry",
    leaseId: "lease-gundarium-0001",
    issuedAt,
    expiresAt,
    requestId: "spore-request-0001",
    signature: "",
  };
  sporeAssertion.signature = await hmacSha256Hex(
    env.SPORE_GATEWAY_HMAC_SECRET,
    sporeAssertionMessage({
      request: sporeRequest,
      assertion: sporeAssertion,
      bodyHash: await sha256Hex(""),
    }),
  );
  const sporeHeaders = {
    "x-warper-spore-grant-id": sporeAssertion.grantId,
    "x-warper-spore-tenant-id": sporeAssertion.tenantId,
    "x-warper-spore-agent-id": sporeAssertion.agentId,
    "x-warper-spore-lease-id": sporeAssertion.leaseId,
    "x-warper-spore-issued-at": sporeAssertion.issuedAt,
    "x-warper-spore-expires-at": sporeAssertion.expiresAt,
    "x-warper-spore-request-id": sporeAssertion.requestId,
    "x-warper-spore-signature": sporeAssertion.signature,
  };
  const sporeSession = await responseJson(
    await handleAgentApi(
      new Request("https://keeper.example/api/agent/session", { headers: sporeHeaders }),
      env,
    ),
  );
  assert.equal(sporeSession.status, 200);
  assert.equal(sporeSession.body.authMode, "spore");
  assert.equal(sporeSession.body.grant.grantId, issued.body.grant.grantId);
  const replayedSporeSession = await responseJson(
    await handleAgentApi(
      new Request("https://keeper.example/api/agent/session", { headers: sporeHeaders }),
      env,
    ),
  );
  assert.equal(replayedSporeSession.status, 401);

  const currentReadCount = db.get(
    "SELECT count FROM agent_rate_limits WHERE grant_id = ? AND mode = 'read'",
    issued.body.grant.grantId,
  ).count;
  env.AGENT_READ_RATE_LIMIT = String(currentReadCount);
  const rateLimited = await responseJson(
    await handleAgentApi(
      new Request("https://keeper.example/api/agent/session", { headers: auth }),
      env,
    ),
  );
  assert.equal(rateLimited.status, 429);
  assert.equal(rateLimited.body.error, "AGENT_RATE_LIMITED");
  delete env.AGENT_READ_RATE_LIMIT;

  const rotated = await responseJson(
    await handleOwnerAgentGrantApi(
      new Request(
        `https://keeper.example/api/miniapp/agent-grants/${issued.body.grant.grantId}/rotate`,
        { method: "POST", headers: { "idempotency-key": "owner-rotate-0001" } },
      ),
      env,
      123456,
    ),
  );
  assert.equal(rotated.status, 200);
  assert.match(rotated.body.directToken, /^wk_agent_/);
  const oldTokenSession = await responseJson(
    await handleAgentApi(
      new Request("https://keeper.example/api/agent/session", { headers: auth }),
      env,
    ),
  );
  assert.equal(oldTokenSession.status, 401);
  const newAuth = { authorization: `Bearer ${rotated.body.directToken}` };
  assert.equal(
    (
      await responseJson(
        await handleAgentApi(
          new Request("https://keeper.example/api/agent/session", { headers: newAuth }),
          env,
        ),
      )
    ).status,
    200,
  );

  const revoked = await responseJson(
    await handleOwnerAgentGrantApi(
      new Request(
        `https://keeper.example/api/miniapp/agent-grants/${issued.body.grant.grantId}/revoke`,
        { method: "POST", headers: { "idempotency-key": "owner-revoke-0001" } },
      ),
      env,
      123456,
    ),
  );
  assert.equal(revoked.status, 200);
  assert.equal(revoked.body.grant.active, false);
  assert.equal(
    (
      await responseJson(
        await handleAgentApi(
          new Request("https://keeper.example/api/agent/session", { headers: newAuth }),
          env,
        ),
      )
    ).status,
    401,
  );
});
