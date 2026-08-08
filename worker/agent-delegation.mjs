const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_GRANT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_GRANT_TTL_MS = 30 * DAY_MS;
const MAX_GRANT_TTL_MS = 90 * DAY_MS;
const MAX_SPORE_ASSERTION_MS = 5 * 60 * 1000;
const SPORE_CLOCK_SKEW_MS = 60 * 1000;

export const AGENT_TOKEN_PREFIX = "wk_agent_";

export const AGENT_PERMISSIONS = Object.freeze([
  "artifact:add",
  "keeper:read",
  "receipt:create",
  "source:add",
  "source:read",
  "trapper:read",
  "trapper:write",
]);

const permissionSet = new Set(AGENT_PERMISSIONS);
const identityPattern = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
const idPattern = /^[A-Za-z0-9._:-]{8,128}$/;
const hexPattern = /^[a-f0-9]{64}$/;

function utf8(value) {
  return new TextEncoder().encode(value);
}

function hex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function requireRecord(value, code = "AGENT_GRANT_BODY_INVALID") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value;
}

function requireExactKeys(record, allowed, code) {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new Error(`${code}:${key}`);
  }
}

export function normalizeIdentity(value, code) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!identityPattern.test(normalized)) throw new Error(code);
  return normalized;
}

export function normalizeId(value, code) {
  const normalized = String(value ?? "").trim();
  if (!idPattern.test(normalized)) throw new Error(code);
  return normalized;
}

export function normalizeAgentGrant(input, ownerKeeperIds, now = new Date()) {
  const record = requireRecord(input);
  requireExactKeys(
    record,
    new Set(["tenantId", "agentId", "keeperIds", "permissions", "expiresAt"]),
    "AGENT_GRANT_UNKNOWN_FIELD",
  );

  const tenantId = normalizeIdentity(record.tenantId, "AGENT_GRANT_TENANT_INVALID");
  const agentId = normalizeIdentity(record.agentId, "AGENT_GRANT_AGENT_INVALID");
  if (!Array.isArray(record.keeperIds) || record.keeperIds.length === 0 || record.keeperIds.length > 32) {
    throw new Error("AGENT_GRANT_KEEPERS_INVALID");
  }
  const available = new Set(ownerKeeperIds.map((value) => String(value)));
  const keeperIds = [...new Set(record.keeperIds.map((value) => String(value).trim()))].sort();
  if (keeperIds.some((keeperId) => !keeperId || !available.has(keeperId))) {
    throw new Error("AGENT_GRANT_KEEPER_NOT_OWNED");
  }

  if (!Array.isArray(record.permissions) || record.permissions.length === 0) {
    throw new Error("AGENT_GRANT_PERMISSIONS_INVALID");
  }
  const permissions = [...new Set(record.permissions.map((value) => String(value).trim()))].sort();
  if (permissions.some((permission) => !permissionSet.has(permission))) {
    throw new Error("AGENT_GRANT_PERMISSION_UNKNOWN");
  }

  const nowMs = now.getTime();
  const expiresMs = record.expiresAt !== undefined
    ? Date.parse(String(record.expiresAt))
    : nowMs + DEFAULT_GRANT_TTL_MS;
  if (!Number.isFinite(expiresMs)) throw new Error("AGENT_GRANT_EXPIRY_INVALID");
  const ttl = expiresMs - nowMs;
  if (ttl < MIN_GRANT_TTL_MS || ttl > MAX_GRANT_TTL_MS) {
    throw new Error("AGENT_GRANT_EXPIRY_OUT_OF_BOUNDS");
  }

  return {
    tenantId,
    agentId,
    keeperIds,
    permissions,
    expiresAt: new Date(expiresMs).toISOString(),
  };
}

export function normalizeGrantRenewal(input, now = new Date()) {
  const record = requireRecord(input, "AGENT_GRANT_RENEWAL_INVALID");
  requireExactKeys(record, new Set(["expiresAt"]), "AGENT_GRANT_RENEWAL_UNKNOWN_FIELD");
  const expiresMs = Date.parse(String(record.expiresAt ?? ""));
  const ttl = expiresMs - now.getTime();
  if (!Number.isFinite(expiresMs) || ttl < MIN_GRANT_TTL_MS || ttl > MAX_GRANT_TTL_MS) {
    throw new Error("AGENT_GRANT_EXPIRY_OUT_OF_BOUNDS");
  }
  return new Date(expiresMs).toISOString();
}

export function parseGrantRow(row, now = new Date()) {
  const keeperIds = JSON.parse(String(row.keeper_ids_json ?? "[]"));
  const permissions = JSON.parse(String(row.permissions_json ?? "[]"));
  if (!Array.isArray(keeperIds) || !Array.isArray(permissions)) {
    throw new Error("AGENT_GRANT_STORAGE_INVALID");
  }
  const grant = {
    grantId: String(row.id),
    ownerFid: Number(row.owner_fid),
    ownerId: `fid:${Number(row.owner_fid)}`,
    tenantId: normalizeIdentity(row.tenant_id, "AGENT_GRANT_STORAGE_INVALID"),
    agentId: normalizeIdentity(row.agent_id, "AGENT_GRANT_STORAGE_INVALID"),
    keeperIds: keeperIds.map(String),
    permissions: permissions.map(String),
    issuedAt: String(row.issued_at),
    expiresAt: String(row.expires_at),
    revokedAt: row.revoked_at ? String(row.revoked_at) : null,
  };
  if (
    !Number.isInteger(grant.ownerFid) ||
    grant.ownerFid <= 0 ||
    grant.keeperIds.some((value) => !value) ||
    grant.permissions.some((value) => !permissionSet.has(value)) ||
    !Number.isFinite(Date.parse(grant.issuedAt)) ||
    !Number.isFinite(Date.parse(grant.expiresAt))
  ) {
    throw new Error("AGENT_GRANT_STORAGE_INVALID");
  }
  return {
    ...grant,
    active: !grant.revokedAt && Date.parse(grant.expiresAt) > now.getTime(),
  };
}

export function createAgentToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `${AGENT_TOKEN_PREFIX}${base64Url(bytes)}`;
}

export async function sha256Hex(value) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(value))));
}

export async function hashAgentToken(token) {
  if (
    typeof token !== "string" ||
    !token.startsWith(AGENT_TOKEN_PREFIX) ||
    token.length < AGENT_TOKEN_PREFIX.length + 40 ||
    token.length > 160
  ) {
    throw new Error("AGENT_TOKEN_INVALID");
  }
  return sha256Hex(token);
}

export function bearerAgentToken(request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice(7).trim();
  return token.startsWith(AGENT_TOKEN_PREFIX) ? token : null;
}

export function requireIdempotencyKey(request) {
  return normalizeId(request.headers.get("idempotency-key"), "AGENT_IDEMPOTENCY_KEY_REQUIRED");
}

export function assertPermission(grant, permission) {
  if (!permissionSet.has(permission) || !grant.permissions.includes(permission)) {
    throw new Error("AGENT_PERMISSION_DENIED");
  }
}

export function assertKeeperAccess(grant, keeperId) {
  if (!grant.keeperIds.includes(String(keeperId))) throw new Error("AGENT_KEEPER_DENIED");
}

export function sporeAssertionFromHeaders(request) {
  const headers = request.headers;
  const signature = String(headers.get("x-warper-spore-signature") ?? "").trim().toLowerCase();
  const assertion = {
    grantId: normalizeId(headers.get("x-warper-spore-grant-id"), "SPORE_ASSERTION_GRANT_INVALID"),
    tenantId: normalizeIdentity(headers.get("x-warper-spore-tenant-id"), "SPORE_ASSERTION_TENANT_INVALID"),
    agentId: normalizeIdentity(headers.get("x-warper-spore-agent-id"), "SPORE_ASSERTION_AGENT_INVALID"),
    leaseId: normalizeId(headers.get("x-warper-spore-lease-id"), "SPORE_ASSERTION_LEASE_INVALID"),
    issuedAt: String(headers.get("x-warper-spore-issued-at") ?? ""),
    expiresAt: String(headers.get("x-warper-spore-expires-at") ?? ""),
    requestId: normalizeId(headers.get("x-warper-spore-request-id"), "SPORE_ASSERTION_REQUEST_INVALID"),
    signature,
  };
  if (!hexPattern.test(signature)) throw new Error("SPORE_ASSERTION_SIGNATURE_INVALID");
  return assertion;
}

export function validateSporeAssertionWindow(assertion, now = new Date()) {
  const nowMs = now.getTime();
  const issuedMs = Date.parse(assertion.issuedAt);
  const expiresMs = Date.parse(assertion.expiresAt);
  if (!Number.isFinite(issuedMs) || !Number.isFinite(expiresMs)) {
    throw new Error("SPORE_ASSERTION_TIME_INVALID");
  }
  if (
    issuedMs > nowMs + SPORE_CLOCK_SKEW_MS ||
    expiresMs <= nowMs ||
    expiresMs - issuedMs <= 0 ||
    expiresMs - issuedMs > MAX_SPORE_ASSERTION_MS
  ) {
    throw new Error("SPORE_ASSERTION_EXPIRED");
  }
}

export function sporeAssertionMessage({ request, assertion, bodyHash }) {
  const url = new URL(request.url);
  return [
    "WARPER-SPORE-AUTH-V1",
    request.method.toUpperCase(),
    `${url.pathname}${url.search}`,
    assertion.grantId,
    assertion.tenantId,
    assertion.agentId,
    assertion.leaseId,
    assertion.issuedAt,
    assertion.expiresAt,
    assertion.requestId,
    bodyHash,
  ].join("\n");
}

export async function hmacSha256Hex(secret, value) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("SPORE_HMAC_SECRET_INVALID");
  const key = await crypto.subtle.importKey(
    "raw",
    utf8(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8(value))));
}

export async function verifySporeAssertion({ request, assertion, bodyHash, secret, now }) {
  validateSporeAssertionWindow(assertion, now);
  const expected = await hmacSha256Hex(
    secret,
    sporeAssertionMessage({ request, assertion, bodyHash }),
  );
  if (expected.length !== assertion.signature.length) throw new Error("SPORE_ASSERTION_SIGNATURE_INVALID");
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ assertion.signature.charCodeAt(index);
  }
  if (difference !== 0) throw new Error("SPORE_ASSERTION_SIGNATURE_INVALID");
  return assertion;
}
