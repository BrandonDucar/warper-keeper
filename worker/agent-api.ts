import {
  assertKeeperAccess,
  assertPermission,
  bearerAgentToken,
  createAgentToken,
  hashAgentToken,
  normalizeAgentGrant,
  normalizeGrantRenewal,
  parseGrantRow,
  requireIdempotencyKey,
  sha256Hex,
  sporeAssertionFromHeaders,
  verifySporeAssertion,
  type AgentGrant,
} from "./agent-delegation.mjs";

interface AgentEnv {
  DB: D1Database;
  AGENT_READ_RATE_LIMIT?: string;
  AGENT_WRITE_RATE_LIMIT?: string;
  SPORE_GATEWAY_HMAC_SECRET?: string;
}

type AgentActor = AgentGrant & {
  authMode: "direct" | "spore";
  leaseId?: string;
};

type JsonRecord = Record<string, unknown>;

function json(payload: unknown, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'",
      "x-content-type-options": "nosniff",
    },
  });
}

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function recordValue(value: unknown, code = "AGENT_BODY_INVALID") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as JsonRecord;
}

function exactKeys(record: JsonRecord, allowed: string[]) {
  const accepted = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!accepted.has(key)) throw new Error(`AGENT_UNKNOWN_FIELD:${key}`);
  }
}

function boundedStrings(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error("AGENT_ARRAY_INVALID");
  return [...new Set(value.map((item) => cleanText(item, maxLength)).filter(Boolean))];
}

function publicHttpsUrl(value: unknown) {
  const raw = cleanText(value, 2_000);
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("AGENT_URL_INVALID");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("AGENT_URL_INVALID");
  }
  return url.toString();
}

function rejectSensitiveText(value: string) {
  const patterns = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
    /\b(?:github_pat|ghp|xox[baprs]|sk_live|sk_test|AIza)[-_A-Za-z0-9]{16,}\b/i,
    /\bBearer\s+[A-Za-z0-9._~-]{20,}/i,
    /\b(?:seed phrase|mnemonic)\s*[:=]/i,
  ];
  if (patterns.some((pattern) => pattern.test(value))) throw new Error("AGENT_SENSITIVE_CONTENT_REJECTED");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("AGENT_JSON_INVALID");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as JsonRecord;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new Error("AGENT_JSON_INVALID");
}

async function sha256Value(value: unknown) {
  return `sha256:${await sha256Hex(canonicalJson(value))}`;
}

async function readJson(request: Request, maxLength = 64_000) {
  const text = await request.text();
  if (text.length > maxLength) throw new Error("AGENT_REQUEST_TOO_LARGE");
  if (!text) return {};
  try {
    return recordValue(JSON.parse(text));
  } catch {
    throw new Error("AGENT_JSON_INVALID");
  }
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "AGENT_REQUEST_FAILED";
  if (/^(AGENT_PERMISSION_DENIED|AGENT_KEEPER_DENIED)/.test(code)) {
    return json({ error: code }, 403);
  }
  if (/^AGENT_(?:GRANT_OPERATION_ALREADY_APPLIED|SOURCE_ALREADY_ATTACHED)/.test(code)) {
    return json({ error: code }, 409);
  }
  if (code === "AGENT_RATE_LIMITED") return json({ error: code }, 429);
  if (/^(AGENT_AUTH|AGENT_TOKEN|SPORE_)/.test(code)) {
    return json({ error: "AGENT_AUTHENTICATION_FAILED" }, 401);
  }
  if (code.endsWith("_NOT_FOUND")) return json({ error: code }, 404);
  if (/^(AGENT_|SPORE_)/.test(code)) return json({ error: code }, 400);
  console.error("warper_keeper_agent_api_error", error);
  return json({ error: "AGENT_REQUEST_FAILED" }, 500);
}

export async function ensureAgentDelegationSchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS agent_grants (
      id TEXT PRIMARY KEY,
      owner_fid INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      keeper_ids_json TEXT NOT NULL,
      permissions_json TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS agent_tokens (
      id TEXT PRIMARY KEY,
      grant_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS agent_grant_events (
      id TEXT PRIMARY KEY,
      grant_id TEXT NOT NULL,
      owner_fid INTEGER NOT NULL,
      action TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      receipt_hash TEXT NOT NULL,
      receipt_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS agent_spore_nonces (
      request_id TEXT PRIMARY KEY,
      grant_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS agent_artifacts (
      id TEXT PRIMARY KEY,
      grant_id TEXT NOT NULL,
      keeper_id TEXT NOT NULL,
      trapper_id TEXT NOT NULL,
      owner_fid INTEGER NOT NULL,
      name TEXT NOT NULL,
      media_type TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      uri TEXT,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS agent_receipts (
      id TEXT PRIMARY KEY,
      grant_id TEXT NOT NULL,
      owner_fid INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      receipt_hash TEXT NOT NULL,
      receipt_json TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS agent_rate_limits (
      window_key TEXT PRIMARY KEY,
      grant_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      window_start TEXT NOT NULL,
      count INTEGER NOT NULL,
      expires_at TEXT NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS agent_grants_owner_idx ON agent_grants(owner_fid, issued_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS agent_grants_identity_idx ON agent_grants(tenant_id, agent_id, expires_at)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS agent_tokens_hash_unique ON agent_tokens(token_hash)"),
    db.prepare("CREATE INDEX IF NOT EXISTS agent_tokens_grant_idx ON agent_tokens(grant_id, issued_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS agent_grant_events_owner_idx ON agent_grant_events(owner_fid, created_at)"),
    db.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS agent_grant_events_idempotency_unique ON agent_grant_events(owner_fid, action, idempotency_key)",
    ),
    db.prepare("CREATE INDEX IF NOT EXISTS agent_artifacts_trapper_idx ON agent_artifacts(trapper_id, created_at)"),
    db.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS agent_receipts_idempotency_unique ON agent_receipts(grant_id, action, idempotency_key)",
    ),
    db.prepare("CREATE INDEX IF NOT EXISTS agent_receipts_owner_idx ON agent_receipts(owner_fid, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS agent_rate_limits_expiry_idx ON agent_rate_limits(expires_at)"),
  ]);
}

function publicGrant(grant: AgentGrant) {
  return {
    grantId: grant.grantId,
    ownerId: grant.ownerId,
    tenantId: grant.tenantId,
    agentId: grant.agentId,
    keeperIds: grant.keeperIds,
    permissions: grant.permissions,
    issuedAt: grant.issuedAt,
    expiresAt: grant.expiresAt,
    revokedAt: grant.revokedAt,
    active: grant.active,
  };
}

async function grantEventStatement(
  db: D1Database,
  grant: AgentGrant,
  action: string,
  idempotencyKey: string,
  createdAt: string,
) {
  const eventId = crypto.randomUUID();
  const envelope = {
    contractVersion: "warper-keeper-agent-grant-event/1",
    eventId,
    grantId: grant.grantId,
    ownerId: grant.ownerId,
    tenantId: grant.tenantId,
    agentId: grant.agentId,
    action,
    idempotencyKey,
    keeperIds: grant.keeperIds,
    permissions: grant.permissions,
    expiresAt: grant.expiresAt,
    createdAt,
  };
  const hash = await sha256Value(envelope);
  return {
    receipt: { ...envelope, hash },
    statement: db
      .prepare(
        `INSERT INTO agent_grant_events (
          id, grant_id, owner_fid, action, idempotency_key, receipt_hash, receipt_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        eventId,
        grant.grantId,
        grant.ownerFid,
        action,
        idempotencyKey,
        hash,
        JSON.stringify(envelope),
        createdAt,
      ),
  };
}

async function ownerOperationKey(
  db: D1Database,
  ownerFid: number,
  request: Request,
  action: string,
) {
  const key = requireIdempotencyKey(request);
  const existing = await db
    .prepare(
      "SELECT grant_id FROM agent_grant_events WHERE owner_fid = ? AND action = ? AND idempotency_key = ? LIMIT 1",
    )
    .bind(ownerFid, action, key)
    .first<JsonRecord>();
  if (existing) {
    throw new Error(`AGENT_GRANT_OPERATION_ALREADY_APPLIED:${String(existing.grant_id)}`);
  }
  return key;
}

async function ownerKeepers(db: D1Database, ownerFid: number) {
  const result = await db
    .prepare("SELECT id FROM keepers WHERE owner_fid = ? ORDER BY created_at ASC")
    .bind(ownerFid)
    .all<JsonRecord>();
  return result.results.map((row) => String(row.id));
}

async function ownerGrant(db: D1Database, ownerFid: number, grantId: string) {
  const row = await db
    .prepare("SELECT * FROM agent_grants WHERE id = ? AND owner_fid = ? LIMIT 1")
    .bind(grantId, ownerFid)
    .first<JsonRecord>();
  if (!row) throw new Error("AGENT_GRANT_NOT_FOUND");
  return parseGrantRow(row);
}

export async function handleOwnerAgentGrantApi(
  request: Request,
  env: AgentEnv,
  ownerFid: number,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/miniapp/agent-grants")) return null;
  try {
    await ensureAgentDelegationSchema(env.DB);

    if (request.method === "GET" && url.pathname === "/api/miniapp/agent-grants") {
      const rows = await env.DB
        .prepare("SELECT * FROM agent_grants WHERE owner_fid = ? ORDER BY issued_at DESC")
        .bind(ownerFid)
        .all<JsonRecord>();
      return json({ grants: rows.results.map((row) => publicGrant(parseGrantRow(row))) });
    }

    if (request.method === "POST" && url.pathname === "/api/miniapp/agent-grants") {
      const operationKey = await ownerOperationKey(env.DB, ownerFid, request, "issued");
      const body = await readJson(request);
      exactKeys(body, ["tenantId", "agentId", "keeperIds", "permissions", "expiresAt", "issueDirectToken"]);
      const normalized = normalizeAgentGrant(
        {
          tenantId: body.tenantId,
          agentId: body.agentId,
          keeperIds: body.keeperIds,
          permissions: body.permissions,
          expiresAt: body.expiresAt,
        },
        await ownerKeepers(env.DB, ownerFid),
      );
      const issueDirectToken = body.issueDirectToken !== false;
      const now = new Date().toISOString();
      const grantId = `wkg_${crypto.randomUUID()}`;
      const grant = parseGrantRow({
        id: grantId,
        owner_fid: ownerFid,
        tenant_id: normalized.tenantId,
        agent_id: normalized.agentId,
        keeper_ids_json: JSON.stringify(normalized.keeperIds),
        permissions_json: JSON.stringify(normalized.permissions),
        issued_at: now,
        expires_at: normalized.expiresAt,
        revoked_at: null,
      });
      const token = issueDirectToken ? createAgentToken() : null;
      const tokenHash = token ? await hashAgentToken(token) : null;
      const event = await grantEventStatement(env.DB, grant, "issued", operationKey, now);
      const statements = [
        env.DB
          .prepare(
            `UPDATE agent_grants SET revoked_at = ?, updated_at = ?
             WHERE owner_fid = ? AND tenant_id = ? AND agent_id = ? AND revoked_at IS NULL`,
          )
          .bind(now, now, ownerFid, normalized.tenantId, normalized.agentId),
        env.DB
          .prepare(
            `UPDATE agent_tokens SET revoked_at = ? WHERE revoked_at IS NULL AND grant_id IN (
              SELECT id FROM agent_grants
              WHERE owner_fid = ? AND tenant_id = ? AND agent_id = ?
            )`,
          )
          .bind(now, ownerFid, normalized.tenantId, normalized.agentId),
        env.DB
          .prepare(
            `INSERT INTO agent_grants (
              id, owner_fid, tenant_id, agent_id, keeper_ids_json, permissions_json,
              issued_at, expires_at, revoked_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
          )
          .bind(
            grantId,
            ownerFid,
            normalized.tenantId,
            normalized.agentId,
            JSON.stringify(normalized.keeperIds),
            JSON.stringify(normalized.permissions),
            now,
            normalized.expiresAt,
            now,
          ),
      ];
      if (tokenHash) {
        statements.push(
          env.DB
            .prepare(
              `INSERT INTO agent_tokens (
                id, grant_id, token_hash, issued_at, expires_at, revoked_at
              ) VALUES (?, ?, ?, ?, ?, NULL)`,
            )
            .bind(`wkt_${crypto.randomUUID()}`, grantId, tokenHash, now, normalized.expiresAt),
        );
      }
      statements.push(event.statement);
      await env.DB.batch(statements);
      return json(
        {
          grant: publicGrant(grant),
          directToken: token,
          tokenNotice: token ? "Shown once. Store it in the delegated agent secret store." : null,
          receipt: event.receipt,
        },
        201,
      );
    }

    const grantMatch = url.pathname.match(/^\/api\/miniapp\/agent-grants\/([^/]+)\/(revoke|renew|rotate)$/);
    if (request.method === "POST" && grantMatch) {
      const grantId = decodeURIComponent(grantMatch[1]);
      const action = grantMatch[2];
      const eventAction =
        action === "revoke" ? "revoked" : action === "renew" ? "renewed" : "token_rotated";
      const operationKey = await ownerOperationKey(env.DB, ownerFid, request, eventAction);
      const current = await ownerGrant(env.DB, ownerFid, grantId);
      if (!current.active && action !== "revoke") throw new Error("AGENT_GRANT_NOT_ACTIVE");
      const now = new Date().toISOString();

      if (action === "revoke") {
        const revoked = { ...current, revokedAt: current.revokedAt ?? now, active: false };
        const event = await grantEventStatement(env.DB, revoked, "revoked", operationKey, now);
        await env.DB.batch([
          env.DB
            .prepare("UPDATE agent_grants SET revoked_at = COALESCE(revoked_at, ?), updated_at = ? WHERE id = ? AND owner_fid = ?")
            .bind(now, now, grantId, ownerFid),
          env.DB
            .prepare("UPDATE agent_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE grant_id = ?")
            .bind(now, grantId),
          event.statement,
        ]);
        return json({ grant: publicGrant(revoked), receipt: event.receipt });
      }

      if (action === "renew") {
        const body = await readJson(request);
        const expiresAt = normalizeGrantRenewal(body);
        const renewed = { ...current, expiresAt, active: true };
        const event = await grantEventStatement(env.DB, renewed, "renewed", operationKey, now);
        await env.DB.batch([
          env.DB
            .prepare("UPDATE agent_grants SET expires_at = ?, updated_at = ? WHERE id = ? AND owner_fid = ? AND revoked_at IS NULL")
            .bind(expiresAt, now, grantId, ownerFid),
          env.DB
            .prepare("UPDATE agent_tokens SET expires_at = ? WHERE grant_id = ? AND revoked_at IS NULL")
            .bind(expiresAt, grantId),
          event.statement,
        ]);
        return json({ grant: publicGrant(renewed), receipt: event.receipt });
      }

      const token = createAgentToken();
      const tokenHash = await hashAgentToken(token);
      const event = await grantEventStatement(env.DB, current, "token_rotated", operationKey, now);
      await env.DB.batch([
        env.DB
          .prepare("UPDATE agent_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE grant_id = ?")
          .bind(now, grantId),
        env.DB
          .prepare(
            `INSERT INTO agent_tokens (
              id, grant_id, token_hash, issued_at, expires_at, revoked_at
            ) VALUES (?, ?, ?, ?, ?, NULL)`,
          )
          .bind(`wkt_${crypto.randomUUID()}`, grantId, tokenHash, now, current.expiresAt),
        event.statement,
      ]);
      return json({
        grant: publicGrant(current),
        directToken: token,
        tokenNotice: "Shown once. The previous token is revoked.",
        receipt: event.receipt,
      });
    }

    return json({ error: "AGENT_GRANT_ROUTE_NOT_FOUND" }, 404);
  } catch (error) {
    return errorResponse(error);
  }
}

async function authenticateAgent(request: Request, env: AgentEnv): Promise<AgentActor> {
  const token = bearerAgentToken(request);
  if (token) {
    const tokenHash = await hashAgentToken(token);
    const row = await env.DB
      .prepare(
        `SELECT g.* FROM agent_tokens t
         JOIN agent_grants g ON g.id = t.grant_id
         WHERE t.token_hash = ? AND t.revoked_at IS NULL AND t.expires_at > ?
           AND g.revoked_at IS NULL AND g.expires_at > ?
         LIMIT 1`,
      )
      .bind(tokenHash, new Date().toISOString(), new Date().toISOString())
      .first<JsonRecord>();
    if (!row) throw new Error("AGENT_AUTH_INVALID");
    return { ...parseGrantRow(row), authMode: "direct" };
  }

  const assertion = sporeAssertionFromHeaders(request);
  const body = await request.clone().text();
  if (body.length > 64_000) throw new Error("AGENT_REQUEST_TOO_LARGE");
  await verifySporeAssertion({
    request,
    assertion,
    bodyHash: await sha256Hex(body),
    secret: env.SPORE_GATEWAY_HMAC_SECRET ?? "",
  });
  const row = await env.DB
    .prepare(
      `SELECT * FROM agent_grants
       WHERE id = ? AND tenant_id = ? AND agent_id = ?
         AND revoked_at IS NULL AND expires_at > ? LIMIT 1`,
    )
    .bind(assertion.grantId, assertion.tenantId, assertion.agentId, new Date().toISOString())
    .first<JsonRecord>();
  if (!row) throw new Error("AGENT_AUTH_INVALID");
  try {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM agent_spore_nonces WHERE expires_at <= ?").bind(new Date().toISOString()),
      env.DB
        .prepare(
          "INSERT INTO agent_spore_nonces (request_id, grant_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
        )
        .bind(assertion.requestId, assertion.grantId, assertion.expiresAt, new Date().toISOString()),
    ]);
  } catch {
    throw new Error("SPORE_ASSERTION_REPLAYED");
  }
  return { ...parseGrantRow(row), authMode: "spore", leaseId: assertion.leaseId };
}

function boundedRate(value: string | undefined, fallback: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10_000) {
    throw new Error("AGENT_RATE_LIMIT_CONFIGURATION_INVALID");
  }
  return parsed;
}

async function consumeAgentRateLimit(
  db: D1Database,
  actor: AgentActor,
  request: Request,
  env: AgentEnv,
) {
  const mode = request.method === "GET" || request.method === "HEAD" ? "read" : "write";
  const limit =
    mode === "read"
      ? boundedRate(env.AGENT_READ_RATE_LIMIT, 120)
      : boundedRate(env.AGENT_WRITE_RATE_LIMIT, 30);
  const now = Date.now();
  const windowStartMs = Math.floor(now / 60_000) * 60_000;
  const windowStart = new Date(windowStartMs).toISOString();
  const expiresAt = new Date(windowStartMs + 2 * 60_000).toISOString();
  const windowKey = `${actor.grantId}:${mode}:${windowStart}`;
  const row = await db
    .prepare(
      `INSERT INTO agent_rate_limits (
        window_key, grant_id, mode, window_start, count, expires_at
      ) VALUES (?, ?, ?, ?, 1, ?)
      ON CONFLICT(window_key) DO UPDATE SET count = count + 1
      RETURNING count`,
    )
    .bind(windowKey, actor.grantId, mode, windowStart, expiresAt)
    .first<{ count: number }>();
  if (Number(row?.count) === 1) {
    await db
      .prepare("DELETE FROM agent_rate_limits WHERE grant_id = ? AND expires_at <= ?")
      .bind(actor.grantId, new Date(now).toISOString())
      .run();
  }
  if (!row || Number(row.count) > limit) throw new Error("AGENT_RATE_LIMITED");
}

async function idempotencyState(
  db: D1Database,
  actor: AgentActor,
  request: Request,
  action: string,
) {
  const key = requireIdempotencyKey(request);
  const row = await db
    .prepare(
      "SELECT response_json FROM agent_receipts WHERE grant_id = ? AND action = ? AND idempotency_key = ? LIMIT 1",
    )
    .bind(actor.grantId, action, key)
    .first<JsonRecord>();
  return {
    key,
    replay: row
      ? json({ ...JSON.parse(String(row.response_json)), idempotentReplay: true })
      : null,
  };
}

async function commitAgentWrite(input: {
  db: D1Database;
  actor: AgentActor;
  action: string;
  resourceType: string;
  resourceId: string;
  keeperId: string;
  trapperId?: string;
  idempotencyKey: string;
  requestBody: unknown;
  statements: D1PreparedStatement[];
  response: JsonRecord;
  status?: number;
}) {
  const receiptId = `wkr_${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  const envelope = {
    contractVersion: "warper-keeper-agent-write-receipt/1",
    receiptId,
    grantId: input.actor.grantId,
    ownerId: input.actor.ownerId,
    tenantId: input.actor.tenantId,
    agentId: input.actor.agentId,
    authMode: input.actor.authMode,
    ...(input.actor.leaseId ? { leaseId: input.actor.leaseId } : {}),
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    keeperId: input.keeperId,
    ...(input.trapperId ? { trapperId: input.trapperId } : {}),
    idempotencyKey: input.idempotencyKey,
    payloadHash: await sha256Value(input.requestBody),
    certification: "none",
    createdAt,
  };
  const hash = await sha256Value(envelope);
  const receipt = { ...envelope, hash };
  const response = { ...input.response, receipt };
  await input.db.batch([
    ...input.statements,
    input.db
      .prepare(
        `INSERT INTO agent_receipts (
          id, grant_id, owner_fid, tenant_id, agent_id, action, resource_type,
          resource_id, idempotency_key, receipt_hash, receipt_json, response_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        receiptId,
        input.actor.grantId,
        input.actor.ownerFid,
        input.actor.tenantId,
        input.actor.agentId,
        input.action,
        input.resourceType,
        input.resourceId,
        input.idempotencyKey,
        hash,
        JSON.stringify(envelope),
        JSON.stringify(response),
        createdAt,
      ),
  ]);
  return json(response, input.status ?? 201);
}

async function ownedKeeper(db: D1Database, actor: AgentActor, keeperId: string) {
  assertKeeperAccess(actor, keeperId);
  const row = await db
    .prepare("SELECT * FROM keepers WHERE id = ? AND owner_fid = ? LIMIT 1")
    .bind(keeperId, actor.ownerFid)
    .first<JsonRecord>();
  if (!row) throw new Error("AGENT_KEEPER_NOT_FOUND");
  return row;
}

async function ownedTrapper(db: D1Database, actor: AgentActor, trapperId: string, openOnly = false) {
  const row = await db
    .prepare(
      `SELECT * FROM trappers WHERE id = ? AND owner_fid = ?${openOnly ? " AND status = 'open'" : ""} LIMIT 1`,
    )
    .bind(trapperId, actor.ownerFid)
    .first<JsonRecord>();
  if (!row) throw new Error("AGENT_TRAPPER_NOT_FOUND");
  assertKeeperAccess(actor, String(row.keeper_id));
  return row;
}

function keeperView(row: JsonRecord) {
  return { id: row.id, name: row.name, template: row.template, createdAt: row.created_at };
}

function trapperView(row: JsonRecord) {
  return {
    id: row.id,
    keeperId: row.keeper_id,
    title: row.title,
    objective: row.objective,
    riskLevel: row.risk_level,
    status: row.status,
    contextCount: row.context_count,
    createdAt: row.created_at,
    ...(row.closed_at ? { closedAt: row.closed_at } : {}),
  };
}

function sourceView(row: JsonRecord) {
  return {
    id: row.id,
    keeperId: row.keeper_id,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    ...(row.url ? { url: row.url } : {}),
    ...(row.commit_sha ? { commitSha: row.commit_sha } : {}),
    ...(row.snapshot_json ? { snapshot: JSON.parse(String(row.snapshot_json)) } : {}),
    ...(row.file_name ? { fileName: row.file_name } : {}),
    ...(row.mime_type ? { mimeType: row.mime_type } : {}),
    ...(row.content_excerpt ? { contentExcerpt: row.content_excerpt } : {}),
    createdAt: row.created_at,
  };
}

async function inspectPublicGitHub(value: unknown) {
  const raw = cleanText(value, 2_000);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("AGENT_GITHUB_URL_INVALID");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    parts.length !== 2 ||
    url.search ||
    url.hash ||
    parts[1].endsWith(".git")
  ) {
    throw new Error("AGENT_GITHUB_URL_INVALID");
  }
  const apiRoot = `https://api.github.com/repos/${parts[0]}/${parts[1]}`;
  const headers = { accept: "application/vnd.github+json", "user-agent": "warper-keeper/1" };
  const metadataResponse = await fetch(apiRoot, { headers, signal: AbortSignal.timeout(5_000) });
  if (!metadataResponse.ok) throw new Error("AGENT_GITHUB_NOT_FOUND");
  const metadata = (await metadataResponse.json()) as { private?: boolean; default_branch?: string };
  if (metadata.private !== false || !metadata.default_branch) throw new Error("AGENT_GITHUB_NOT_PUBLIC");
  const commitResponse = await fetch(`${apiRoot}/commits/${encodeURIComponent(metadata.default_branch)}`, {
    headers,
    signal: AbortSignal.timeout(5_000),
  });
  if (!commitResponse.ok) throw new Error("AGENT_GITHUB_COMMIT_NOT_FOUND");
  const commit = (await commitResponse.json()) as { sha?: string };
  if (!commit.sha || !/^[a-f0-9]{40}$/i.test(commit.sha)) throw new Error("AGENT_GITHUB_COMMIT_INVALID");
  const commitSha = commit.sha.toLowerCase();
  const treeResponse = await fetch(`${apiRoot}/git/trees/${commitSha}?recursive=1`, {
    headers,
    signal: AbortSignal.timeout(8_000),
  });
  if (!treeResponse.ok) throw new Error("AGENT_GITHUB_TREE_NOT_FOUND");
  const tree = (await treeResponse.json()) as { tree?: Array<{ path?: string; type?: string }> };
  const files = (tree.tree ?? [])
    .filter((item) => item.type === "blob" && item.path)
    .map((item) => String(item.path))
    .slice(0, 500);
  return {
    url: `https://github.com/${parts[0]}/${parts[1]}`,
    commitSha,
    snapshot: {
      owner: parts[0],
      repository: parts[1],
      defaultBranch: metadata.default_branch,
      commitSha,
      fileCount: files.length,
      files,
      clonedAt: new Date().toISOString(),
    },
  };
}

export async function handleAgentApi(request: Request, env: AgentEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/agent/")) return null;
  try {
    await ensureAgentDelegationSchema(env.DB);
    const actor = await authenticateAgent(request, env);
    await consumeAgentRateLimit(env.DB, actor, request, env);

    if (request.method === "GET" && url.pathname === "/api/agent/session") {
      return json({ grant: publicGrant(actor), authMode: actor.authMode, leaseId: actor.leaseId ?? null });
    }

    if (request.method === "GET" && url.pathname === "/api/agent/keepers") {
      assertPermission(actor, "keeper:read");
      const placeholders = actor.keeperIds.map(() => "?").join(",");
      const rows = await env.DB
        .prepare(`SELECT * FROM keepers WHERE owner_fid = ? AND id IN (${placeholders}) ORDER BY created_at ASC`)
        .bind(actor.ownerFid, ...actor.keeperIds)
        .all<JsonRecord>();
      return json({ keepers: rows.results.map(keeperView) });
    }

    const keeperMatch = url.pathname.match(/^\/api\/agent\/keepers\/([^/]+)$/);
    if (request.method === "GET" && keeperMatch) {
      assertPermission(actor, "keeper:read");
      return json({ keeper: keeperView(await ownedKeeper(env.DB, actor, decodeURIComponent(keeperMatch[1]))) });
    }

    if (request.method === "GET" && url.pathname === "/api/agent/trappers") {
      assertPermission(actor, "trapper:read");
      const keeperId = cleanText(url.searchParams.get("keeperId"), 120);
      if (keeperId) {
        await ownedKeeper(env.DB, actor, keeperId);
        const rows = await env.DB
          .prepare("SELECT * FROM trappers WHERE owner_fid = ? AND keeper_id = ? ORDER BY created_at DESC LIMIT 100")
          .bind(actor.ownerFid, keeperId)
          .all<JsonRecord>();
        return json({ trappers: rows.results.map(trapperView) });
      }
      const placeholders = actor.keeperIds.map(() => "?").join(",");
      const rows = await env.DB
        .prepare(
          `SELECT * FROM trappers WHERE owner_fid = ? AND keeper_id IN (${placeholders}) ORDER BY created_at DESC LIMIT 100`,
        )
        .bind(actor.ownerFid, ...actor.keeperIds)
        .all<JsonRecord>();
      return json({ trappers: rows.results.map(trapperView) });
    }

    const trapperDetailMatch = url.pathname.match(/^\/api\/agent\/trappers\/([^/]+)$/);
    if (request.method === "GET" && trapperDetailMatch) {
      assertPermission(actor, "trapper:read");
      const trapper = await ownedTrapper(env.DB, actor, decodeURIComponent(trapperDetailMatch[1]));
      const contexts = await env.DB
        .prepare("SELECT id, content, created_at FROM context_items WHERE trapper_id = ? AND owner_fid = ? ORDER BY created_at ASC")
        .bind(trapper.id, actor.ownerFid)
        .all<JsonRecord>();
      const artifacts = await env.DB
        .prepare("SELECT * FROM agent_artifacts WHERE trapper_id = ? AND owner_fid = ? ORDER BY created_at ASC")
        .bind(trapper.id, actor.ownerFid)
        .all<JsonRecord>();
      return json({
        trapper: trapperView(trapper),
        context: contexts.results.map((row) => ({ id: row.id, content: row.content, createdAt: row.created_at })),
        artifacts: artifacts.results.map((row) => ({
          id: row.id,
          name: row.name,
          mediaType: row.media_type,
          contentHash: row.content_hash,
          ...(row.uri ? { uri: row.uri } : {}),
          summary: row.summary,
          createdAt: row.created_at,
        })),
      });
    }

    if (request.method === "GET" && url.pathname === "/api/agent/sources") {
      assertPermission(actor, "source:read");
      const keeperId = cleanText(url.searchParams.get("keeperId"), 120);
      if (!keeperId) throw new Error("AGENT_KEEPER_REQUIRED");
      await ownedKeeper(env.DB, actor, keeperId);
      const rows = await env.DB
        .prepare("SELECT * FROM sources WHERE owner_fid = ? AND keeper_id = ? ORDER BY created_at DESC LIMIT 200")
        .bind(actor.ownerFid, keeperId)
        .all<JsonRecord>();
      return json({ sources: rows.results.map(sourceView) });
    }

    if (request.method === "POST" && url.pathname === "/api/agent/trappers") {
      assertPermission(actor, "trapper:write");
      const action = "trapper:create";
      const state = await idempotencyState(env.DB, actor, request, action);
      if (state.replay) return state.replay;
      const body = await readJson(request);
      exactKeys(body, ["keeperId", "title", "objective", "riskLevel"]);
      const keeperId = cleanText(body.keeperId, 120);
      const title = cleanText(body.title, 100);
      const objective = cleanText(body.objective, 1_200);
      const riskLevel = cleanText(body.riskLevel, 12);
      if (!keeperId || !title || !objective || !["low", "medium", "high"].includes(riskLevel)) {
        throw new Error("AGENT_TRAPPER_INVALID");
      }
      rejectSensitiveText(`${title}\n${objective}`);
      await ownedKeeper(env.DB, actor, keeperId);
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      return commitAgentWrite({
        db: env.DB,
        actor,
        action,
        resourceType: "trapper",
        resourceId: id,
        keeperId,
        idempotencyKey: state.key,
        requestBody: body,
        statements: [
          env.DB
            .prepare(
              `INSERT INTO trappers (
                id, keeper_id, owner_fid, title, objective, risk_level,
                status, context_count, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, 'open', 0, ?)`,
            )
            .bind(id, keeperId, actor.ownerFid, title, objective, riskLevel, createdAt),
        ],
        response: { trapper: { id, keeperId, title, riskLevel, status: "open", createdAt } },
      });
    }

    if (request.method === "POST" && url.pathname === "/api/agent/sources") {
      assertPermission(actor, "source:add");
      const action = "source:add";
      const state = await idempotencyState(env.DB, actor, request, action);
      if (state.replay) return state.replay;
      const body = await readJson(request);
      exactKeys(body, ["keeperId", "kind", "title", "summary", "url", "fileName", "mimeType", "contentExcerpt"]);
      const keeperId = cleanText(body.keeperId, 120);
      const kind = cleanText(body.kind, 20);
      const title = cleanText(body.title, 120);
      const summary = cleanText(body.summary, 4_000);
      if (!keeperId || !["note", "link", "repository", "file"].includes(kind) || !title || !summary) {
        throw new Error("AGENT_SOURCE_INVALID");
      }
      rejectSensitiveText(`${title}\n${summary}\n${cleanText(body.contentExcerpt, 12_000)}`);
      await ownedKeeper(env.DB, actor, keeperId);
      let sourceUrl: string | null = null;
      let commitSha: string | null = null;
      let snapshot: JsonRecord | null = null;
      let fileName: string | null = null;
      let mimeType: string | null = null;
      let contentExcerpt: string | null = null;
      if (kind === "repository") {
        const inspected = await inspectPublicGitHub(body.url);
        sourceUrl = inspected.url;
        commitSha = inspected.commitSha;
        snapshot = inspected.snapshot;
      } else if (kind === "link") {
        sourceUrl = publicHttpsUrl(body.url);
        if (!sourceUrl) throw new Error("AGENT_URL_INVALID");
      } else if (kind === "file") {
        fileName = cleanText(body.fileName, 240);
        mimeType = cleanText(body.mimeType, 120) || "application/octet-stream";
        contentExcerpt = cleanText(body.contentExcerpt, 12_000) || null;
        if (!fileName) throw new Error("AGENT_FILE_INVALID");
      }
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      return commitAgentWrite({
        db: env.DB,
        actor,
        action,
        resourceType: "source",
        resourceId: id,
        keeperId,
        idempotencyKey: state.key,
        requestBody: body,
        statements: [
          env.DB
            .prepare(
              `INSERT INTO sources (
                id, keeper_id, owner_fid, kind, title, summary, url, commit_sha,
                snapshot_json, file_name, mime_type, content_excerpt, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              id,
              keeperId,
              actor.ownerFid,
              kind,
              title,
              summary,
              sourceUrl,
              commitSha,
              snapshot ? JSON.stringify(snapshot) : null,
              fileName,
              mimeType,
              contentExcerpt,
              createdAt,
            ),
        ],
        response: { source: { id, keeperId, kind, title, createdAt } },
      });
    }

    const contextMatch = url.pathname.match(/^\/api\/agent\/trappers\/([^/]+)\/context$/);
    if (request.method === "POST" && contextMatch) {
      assertPermission(actor, "trapper:write");
      const action = "trapper:context:append";
      const state = await idempotencyState(env.DB, actor, request, action);
      if (state.replay) return state.replay;
      const body = await readJson(request);
      exactKeys(body, ["content"]);
      const content = cleanText(body.content, 4_000);
      if (!content) throw new Error("AGENT_CONTEXT_INVALID");
      rejectSensitiveText(content);
      const trapper = await ownedTrapper(env.DB, actor, decodeURIComponent(contextMatch[1]), true);
      const contextId = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      return commitAgentWrite({
        db: env.DB,
        actor,
        action,
        resourceType: "context",
        resourceId: contextId,
        keeperId: String(trapper.keeper_id),
        trapperId: String(trapper.id),
        idempotencyKey: state.key,
        requestBody: body,
        statements: [
          env.DB
            .prepare("INSERT INTO context_items (id, trapper_id, owner_fid, content, created_at) VALUES (?, ?, ?, ?, ?)")
            .bind(contextId, trapper.id, actor.ownerFid, content, createdAt),
          env.DB
            .prepare("UPDATE trappers SET context_count = context_count + 1 WHERE id = ? AND owner_fid = ?")
            .bind(trapper.id, actor.ownerFid),
        ],
        response: { context: { id: contextId, trapperId: trapper.id, createdAt } },
      });
    }

    const trapperSourceMatch = url.pathname.match(/^\/api\/agent\/trappers\/([^/]+)\/sources$/);
    if (request.method === "POST" && trapperSourceMatch) {
      assertPermission(actor, "trapper:write");
      assertPermission(actor, "source:read");
      const action = "trapper:source:attach";
      const state = await idempotencyState(env.DB, actor, request, action);
      if (state.replay) return state.replay;
      const body = await readJson(request);
      exactKeys(body, ["sourceId"]);
      const sourceId = cleanText(body.sourceId, 120);
      if (!sourceId) throw new Error("AGENT_SOURCE_INVALID");
      const trapper = await ownedTrapper(env.DB, actor, decodeURIComponent(trapperSourceMatch[1]), true);
      const source = await env.DB
        .prepare("SELECT id FROM sources WHERE id = ? AND keeper_id = ? AND owner_fid = ? LIMIT 1")
        .bind(sourceId, trapper.keeper_id, actor.ownerFid)
        .first<JsonRecord>();
      if (!source) throw new Error("AGENT_SOURCE_NOT_FOUND");
      const duplicate = await env.DB
        .prepare("SELECT id FROM trapper_sources WHERE trapper_id = ? AND source_id = ? LIMIT 1")
        .bind(trapper.id, sourceId)
        .first<JsonRecord>();
      if (duplicate) throw new Error("AGENT_SOURCE_ALREADY_ATTACHED");
      const linkId = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      return commitAgentWrite({
        db: env.DB,
        actor,
        action,
        resourceType: "trapper_source",
        resourceId: linkId,
        keeperId: String(trapper.keeper_id),
        trapperId: String(trapper.id),
        idempotencyKey: state.key,
        requestBody: body,
        statements: [
          env.DB
            .prepare("INSERT INTO trapper_sources (id, trapper_id, source_id, owner_fid, created_at) VALUES (?, ?, ?, ?, ?)")
            .bind(linkId, trapper.id, sourceId, actor.ownerFid, createdAt),
          env.DB
            .prepare("UPDATE trappers SET context_count = context_count + 1 WHERE id = ? AND owner_fid = ?")
            .bind(trapper.id, actor.ownerFid),
        ],
        response: { attachment: { id: linkId, trapperId: trapper.id, sourceId, createdAt } },
      });
    }

    const artifactMatch = url.pathname.match(/^\/api\/agent\/trappers\/([^/]+)\/artifacts$/);
    if (request.method === "POST" && artifactMatch) {
      assertPermission(actor, "artifact:add");
      const action = "artifact:add";
      const state = await idempotencyState(env.DB, actor, request, action);
      if (state.replay) return state.replay;
      const body = await readJson(request);
      exactKeys(body, ["name", "mediaType", "contentHash", "uri", "summary"]);
      const name = cleanText(body.name, 240);
      const mediaType = cleanText(body.mediaType, 120);
      const contentHash = cleanText(body.contentHash, 80).toLowerCase();
      const uri = body.uri ? publicHttpsUrl(body.uri) : null;
      const summary = cleanText(body.summary, 2_000);
      if (!name || !mediaType || !/^sha256:[a-f0-9]{64}$/.test(contentHash) || !summary) {
        throw new Error("AGENT_ARTIFACT_INVALID");
      }
      rejectSensitiveText(`${name}\n${summary}`);
      const trapper = await ownedTrapper(env.DB, actor, decodeURIComponent(artifactMatch[1]), true);
      const artifactId = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      return commitAgentWrite({
        db: env.DB,
        actor,
        action,
        resourceType: "artifact",
        resourceId: artifactId,
        keeperId: String(trapper.keeper_id),
        trapperId: String(trapper.id),
        idempotencyKey: state.key,
        requestBody: body,
        statements: [
          env.DB
            .prepare(
              `INSERT INTO agent_artifacts (
                id, grant_id, keeper_id, trapper_id, owner_fid, name, media_type,
                content_hash, uri, summary, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              artifactId,
              actor.grantId,
              trapper.keeper_id,
              trapper.id,
              actor.ownerFid,
              name,
              mediaType,
              contentHash,
              uri,
              summary,
              createdAt,
            ),
        ],
        response: { artifact: { id: artifactId, trapperId: trapper.id, name, mediaType, contentHash, uri, createdAt } },
      });
    }

    const receiptMatch = url.pathname.match(/^\/api\/agent\/trappers\/([^/]+)\/receipts$/);
    if (request.method === "POST" && receiptMatch) {
      assertPermission(actor, "receipt:create");
      const action = "receipt:create";
      const state = await idempotencyState(env.DB, actor, request, action);
      if (state.replay) return state.replay;
      const body = await readJson(request);
      exactKeys(body, ["status", "summary", "evidenceRefs", "selfAttested"]);
      const status = cleanText(body.status, 20);
      const summary = cleanText(body.summary, 4_000);
      const evidenceRefs = boundedStrings(body.evidenceRefs ?? [], 20, 500);
      if (!["completed", "partial", "failed"].includes(status) || !summary || body.selfAttested !== true) {
        throw new Error("AGENT_RECEIPT_INVALID");
      }
      rejectSensitiveText(summary);
      const trapper = await ownedTrapper(env.DB, actor, decodeURIComponent(receiptMatch[1]));
      const receiptId = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const payload = {
        contractVersion: "warper-keeper-agent-result/1",
        receiptId,
        grantId: actor.grantId,
        ownerId: actor.ownerId,
        tenantId: actor.tenantId,
        agentId: actor.agentId,
        keeperId: trapper.keeper_id,
        trapperId: trapper.id,
        status,
        summary,
        evidenceRefs,
        selfAttested: true,
        certification: "none",
        createdAt,
      };
      const resultHash = await sha256Value(payload);
      return commitAgentWrite({
        db: env.DB,
        actor,
        action,
        resourceType: "agent_result",
        resourceId: receiptId,
        keeperId: String(trapper.keeper_id),
        trapperId: String(trapper.id),
        idempotencyKey: state.key,
        requestBody: body,
        statements: [
          env.DB
            .prepare("INSERT INTO receipts (id, trapper_id, owner_fid, hash, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(receiptId, trapper.id, actor.ownerFid, resultHash, JSON.stringify(payload), createdAt),
        ],
        response: { result: { id: receiptId, trapperId: trapper.id, hash: resultHash, status, certification: "none", createdAt } },
      });
    }

    return json({ error: "AGENT_ROUTE_NOT_FOUND" }, 404);
  } catch (error) {
    return errorResponse(error);
  }
}
