import { createClient } from "@farcaster/quick-auth";
import {
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
  handleImageOptimization,
} from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { handleAgentApi, handleOwnerAgentGrantApi } from "./agent-api";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: {
          format: string;
          quality: number;
        }): Promise<{ response(): Response }>;
      };
    };
  };
  AGENT_GATEWAY_HEALTH_URL?: string;
  AGENT_READ_RATE_LIMIT?: string;
  AGENT_WRITE_RATE_LIMIT?: string;
  SPORE_GATEWAY_HMAC_SECRET?: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const quickAuth = createClient();
const templates = new Set(["project", "research", "content", "operations"]);
const themes = new Set(["signal", "voltage", "archive"]);
const risks = new Set(["low", "medium", "high"]);
const sourceKinds = new Set(["note", "link", "repository", "file"]);

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

function recordValue(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected an object");
  }
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown, maxItems: number) {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error("Expected a bounded array");
  }
  return value.map(recordValue);
}

function storedStickers(value: unknown) {
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed)
      ? parsed
          .map((item) => cleanText(item, 10).toUpperCase())
          .filter(Boolean)
          .slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

function storedObject(value: unknown) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function cleanRepositorySnapshot(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as Record<string, unknown>;
  const owner = cleanText(snapshot.owner, 100);
  const repository = cleanText(snapshot.repository, 100);
  const defaultBranch = cleanText(snapshot.defaultBranch, 180);
  const commitSha = cleanText(snapshot.commitSha, 40).toLowerCase();
  if (
    !owner ||
    !repository ||
    !defaultBranch ||
    !/^[a-f0-9]{40}$/.test(commitSha)
  ) {
    return null;
  }
  const files = Array.isArray(snapshot.files)
    ? snapshot.files
        .map((item) => cleanText(item, 320))
        .filter(Boolean)
        .slice(0, 500)
    : [];
  return {
    owner,
    repository,
    defaultBranch,
    commitSha,
    fileCount: Math.max(
      files.length,
      Math.min(100_000, Math.max(0, Number(snapshot.fileCount) || 0)),
    ),
    files,
    ...(cleanText(snapshot.readmeExcerpt, 2_000)
      ? { readmeExcerpt: cleanText(snapshot.readmeExcerpt, 2_000) }
      : {}),
    clonedAt: cleanText(snapshot.clonedAt, 40) || new Date().toISOString(),
  };
}

function cleanUrl(value: unknown) {
  const text = cleanText(value, 2_000);
  if (!text) return null;
  const url = new URL(text);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Only public HTTPS URLs are supported");
  }
  return url.toString();
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite proof value");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new Error("Proof value must be JSON-compatible");
}

async function inspectPublicGitHub(value: unknown) {
  const raw = cleanText(value, 2_000);
  const url = new URL(raw);
  const parts = url.pathname.split("/").filter(Boolean);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    parts.length !== 2 ||
    url.search ||
    url.hash ||
    parts[1].endsWith(".git")
  ) {
    throw new Error("Use a public github.com/owner/repository URL");
  }
  const canonicalUrl = `https://github.com/${parts[0]}/${parts[1]}`;
  const apiRoot = `https://api.github.com/repos/${parts[0]}/${parts[1]}`;
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "warper-keeper/1",
  };
  const metadataResponse = await fetch(apiRoot, {
    headers,
    signal: AbortSignal.timeout(5_000),
  });
  if (!metadataResponse.ok) throw new Error("Public repository was not found");
  const metadata = (await metadataResponse.json()) as {
    private?: boolean;
    default_branch?: string;
  };
  if (metadata.private !== false || !metadata.default_branch) {
    throw new Error("Repository must be public");
  }
  const commitResponse = await fetch(
    `${apiRoot}/commits/${encodeURIComponent(metadata.default_branch)}`,
    { headers, signal: AbortSignal.timeout(5_000) },
  );
  if (!commitResponse.ok) throw new Error("Repository commit could not be read");
  const commit = (await commitResponse.json()) as { sha?: string };
  if (!commit.sha || !/^[a-f0-9]{40}$/i.test(commit.sha)) {
    throw new Error("Repository returned an invalid commit");
  }
  const commitSha = commit.sha.toLowerCase();
  const treeResponse = await fetch(`${apiRoot}/git/trees/${commitSha}?recursive=1`, {
    headers,
    signal: AbortSignal.timeout(8_000),
  });
  if (!treeResponse.ok) throw new Error("Repository tree could not be indexed");
  const tree = (await treeResponse.json()) as {
    tree?: Array<{ path?: string; type?: string }>;
  };
  const blobs = (tree.tree ?? []).filter((item) => item.type === "blob" && item.path);
  const readmeResponse = await fetch(`${apiRoot}/readme`, {
    headers: {
      ...headers,
      accept: "application/vnd.github.raw+json",
    },
    signal: AbortSignal.timeout(5_000),
  });
  const readmeExcerpt = readmeResponse.ok
    ? cleanText((await readmeResponse.text()).replace(/\s+/g, " "), 2_000)
    : "";
  return {
    canonicalUrl,
    commitSha,
    snapshot: {
      owner: parts[0],
      repository: parts[1],
      defaultBranch: metadata.default_branch,
      commitSha,
      fileCount: blobs.length,
      files: blobs.map((item) => item.path!).slice(0, 500),
      ...(readmeExcerpt ? { readmeExcerpt } : {}),
      clonedAt: new Date().toISOString(),
    },
  };
}

async function readJson(request: Request, maxLength = 32_000) {
  const text = await request.text();
  if (text.length > maxLength) throw new Error("Request is too large");
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

async function ownerFid(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  try {
    const payload = await quickAuth.verifyJwt({
      token: authorization.slice(7),
      domain: new URL(request.url).hostname,
    });
    return Number(payload.sub);
  } catch {
    return null;
  }
}

async function ensureSchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS keepers (
      id TEXT PRIMARY KEY,
      owner_fid INTEGER NOT NULL UNIQUE,
      name TEXT NOT NULL,
      template TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS keeper_personalization (
      keeper_id TEXT PRIMARY KEY,
      owner_fid INTEGER NOT NULL UNIQUE,
      theme TEXT NOT NULL,
      tagline TEXT NOT NULL,
      stickers_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS trappers (
      id TEXT PRIMARY KEY,
      keeper_id TEXT NOT NULL,
      owner_fid INTEGER NOT NULL,
      title TEXT NOT NULL,
      objective TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      status TEXT NOT NULL,
      context_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      closed_at TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS context_items (
      id TEXT PRIMARY KEY,
      trapper_id TEXT NOT NULL,
      owner_fid INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS receipts (
      id TEXT PRIMARY KEY,
      trapper_id TEXT NOT NULL,
      owner_fid INTEGER NOT NULL,
      hash TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      keeper_id TEXT NOT NULL,
      owner_fid INTEGER NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      url TEXT,
      commit_sha TEXT,
      snapshot_json TEXT,
      file_name TEXT,
      mime_type TEXT,
      content_excerpt TEXT,
      created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS trapper_sources (
      id TEXT PRIMARY KEY,
      trapper_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      owner_fid INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS trapper_shares (
      token TEXT PRIMARY KEY,
      trapper_id TEXT NOT NULL,
      keeper_id TEXT NOT NULL,
      owner_fid INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      revoked_at TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS source_relations (
      id TEXT PRIMARY KEY,
      keeper_id TEXT NOT NULL,
      owner_fid INTEGER NOT NULL,
      from_source_id TEXT NOT NULL,
      to_source_id TEXT NOT NULL,
      label TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS proof_drops (
      id TEXT PRIMARY KEY,
      keeper_id TEXT NOT NULL,
      owner_fid INTEGER NOT NULL,
      title TEXT NOT NULL,
      purpose TEXT NOT NULL,
      source_ids_json TEXT NOT NULL,
      hash TEXT NOT NULL,
      envelope_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS trappers_owner_idx ON trappers(owner_fid, created_at)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS receipts_owner_idx ON receipts(owner_fid, created_at)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS sources_owner_idx ON sources(owner_fid, created_at)",
    ),
    db.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS trapper_sources_pair_idx ON trapper_sources(trapper_id, source_id)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS trapper_sources_owner_idx ON trapper_sources(owner_fid, created_at)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS trapper_shares_owner_idx ON trapper_shares(owner_fid, created_at)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS source_relations_owner_idx ON source_relations(owner_fid, created_at)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS proof_drops_owner_idx ON proof_drops(owner_fid, created_at)",
    ),
  ]);
}

function keeperFromRow(row: Record<string, unknown> | null) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    template: row.template,
    createdAt: row.created_at,
  };
}

function personalizationFromRow(row: Record<string, unknown> | null) {
  if (!row) {
    return {
      theme: "signal",
      tagline: "Working context, ready to move.",
      stickers: ["WK"],
    };
  }
  return {
    theme: themes.has(String(row.theme)) ? row.theme : "signal",
    tagline: cleanText(row.tagline, 80),
    stickers: storedStickers(row.stickers_json),
  };
}

function trapperFromRow(row: Record<string, unknown>, sourceIds: string[] = []) {
  return {
    id: row.id,
    keeperId: row.keeper_id,
    title: row.title,
    objective: row.objective,
    riskLevel: row.risk_level,
    status: row.status,
    contextCount: row.context_count,
    sourceIds,
    createdAt: row.created_at,
    ...(row.closed_at ? { closedAt: row.closed_at } : {}),
  };
}

function receiptFromRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    trapperId: row.trapper_id,
    hash: row.hash,
    payload: JSON.parse(String(row.payload_json)),
    createdAt: row.created_at,
  };
}

function sourceFromRow(row: Record<string, unknown>) {
  const snapshot = cleanRepositorySnapshot(storedObject(row.snapshot_json));
  return {
    id: row.id,
    keeperId: row.keeper_id,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    ...(row.url ? { url: row.url } : {}),
    ...(row.commit_sha ? { commitSha: row.commit_sha } : {}),
    ...(snapshot ? { snapshot } : {}),
    ...(row.file_name ? { fileName: row.file_name } : {}),
    ...(row.mime_type ? { mimeType: row.mime_type } : {}),
    ...(row.content_excerpt ? { contentExcerpt: row.content_excerpt } : {}),
    createdAt: row.created_at,
  };
}

function relationFromRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    keeperId: row.keeper_id,
    fromSourceId: row.from_source_id,
    toSourceId: row.to_source_id,
    label: row.label,
    createdAt: row.created_at,
  };
}

function proofDropFromRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    keeperId: row.keeper_id,
    title: row.title,
    purpose: row.purpose,
    sourceIds: JSON.parse(String(row.source_ids_json)),
    hash: row.hash,
    envelope: JSON.parse(String(row.envelope_json)),
    createdAt: row.created_at,
  };
}

async function stateFor(db: D1Database, fid: number) {
  const [
    keeper,
    personalization,
    trappers,
    receipts,
    sources,
    trapperSources,
    relations,
    proofDrops,
  ] = await Promise.all([
    db
      .prepare("SELECT * FROM keepers WHERE owner_fid = ? LIMIT 1")
      .bind(fid)
      .first<Record<string, unknown>>(),
    db
      .prepare("SELECT * FROM keeper_personalization WHERE owner_fid = ? LIMIT 1")
      .bind(fid)
      .first<Record<string, unknown>>(),
    db
      .prepare(
        "SELECT * FROM trappers WHERE owner_fid = ? ORDER BY created_at DESC",
      )
      .bind(fid)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        "SELECT * FROM receipts WHERE owner_fid = ? ORDER BY created_at DESC",
      )
      .bind(fid)
      .all<Record<string, unknown>>(),
    db
      .prepare("SELECT * FROM sources WHERE owner_fid = ? ORDER BY created_at DESC")
      .bind(fid)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        "SELECT trapper_id, source_id FROM trapper_sources WHERE owner_fid = ? ORDER BY created_at ASC",
      )
      .bind(fid)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        "SELECT * FROM source_relations WHERE owner_fid = ? ORDER BY created_at DESC",
      )
      .bind(fid)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        "SELECT * FROM proof_drops WHERE owner_fid = ? ORDER BY created_at DESC",
      )
      .bind(fid)
      .all<Record<string, unknown>>(),
  ]);
  const sourceIdsByTrapper = new Map<string, string[]>();
  for (const link of trapperSources.results) {
    const trapperId = String(link.trapper_id);
    const sourceId = String(link.source_id);
    sourceIdsByTrapper.set(trapperId, [
      ...(sourceIdsByTrapper.get(trapperId) ?? []),
      sourceId,
    ]);
  }
  return {
    keeper: keeperFromRow(keeper),
    personalization: personalizationFromRow(personalization),
    trappers: trappers.results.map((row) =>
      trapperFromRow(row, sourceIdsByTrapper.get(String(row.id)) ?? []),
    ),
    receipts: receipts.results.map(receiptFromRow),
    sources: sources.results.map(sourceFromRow),
    relations: relations.results.map(relationFromRow),
    proofDrops: proofDrops.results.map(proofDropFromRow),
  };
}

async function sha256(payload: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload),
  );
  return `sha256:${Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

async function sha256Value(payload: unknown) {
  return sha256(canonicalJson(payload));
}

async function handleApi(request: Request, env: Env) {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/api/gateway-health") {
    const gatewayUrl = env.AGENT_GATEWAY_HEALTH_URL?.trim();
    if (!gatewayUrl) {
      return json({ ok: false, gateway: "warper-keeper", configured: false }, 503);
    }
    try {
      const target = new URL(gatewayUrl);
      if (target.protocol !== "https:" || target.username || target.password) {
        throw new Error("Gateway health URL must be public HTTPS");
      }
      const response = await fetch(target, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(4_000),
      });
      return json(
        { ok: response.ok, gateway: "warper-keeper", configured: true },
        response.ok ? 200 : 503,
      );
    } catch {
      return json({ ok: false, gateway: "warper-keeper", configured: true }, 503);
    }
  }

  const publicShareMatch = url.pathname.match(/^\/api\/trapper-share\/([A-Za-z0-9_-]{20,80})$/);
  if (request.method === "GET" && publicShareMatch) {
    await ensureSchema(env.DB);
    const share = await env.DB.prepare(
      `SELECT payload_json, created_at FROM trapper_shares
       WHERE token = ? AND revoked_at IS NULL LIMIT 1`,
    )
      .bind(publicShareMatch[1])
      .first<Record<string, unknown>>();
    if (!share) return json({ error: "Shared Trapper not found" }, 404);
    return json({
      bundle: JSON.parse(String(share.payload_json)),
      sharedAt: share.created_at,
    });
  }

  const agentResponse = await handleAgentApi(request, env);
  if (agentResponse) return agentResponse;

  if (!url.pathname.startsWith("/api/miniapp/")) return null;
  const fid = await ownerFid(request);
  if (!fid) return json({ error: "Farcaster authentication required" }, 401);
  await ensureSchema(env.DB);

  const ownerAgentGrantResponse = await handleOwnerAgentGrantApi(request, env, fid);
  if (ownerAgentGrantResponse) return ownerAgentGrantResponse;

  if (request.method === "GET" && url.pathname === "/api/miniapp/state") {
    return json(await stateFor(env.DB, fid));
  }

  if (request.method === "POST" && url.pathname === "/api/miniapp/import") {
    const body = await readJson(request, 1_000_000);
    const importedKeeper = recordValue(body.keeper);
    const name = cleanText(importedKeeper.name, 42);
    const template = cleanText(importedKeeper.template, 20);
    if (!name || !templates.has(template)) {
      return json({ error: "Imported Keeper is invalid" }, 400);
    }
    const importedPersonalization = recordValue(body.personalization ?? {});
    const importedTheme = cleanText(importedPersonalization.theme, 20);
    const personalization = {
      theme: themes.has(importedTheme) ? importedTheme : "signal",
      tagline:
        cleanText(importedPersonalization.tagline, 80) ||
        "Working context, ready to move.",
      stickers: Array.isArray(importedPersonalization.stickers)
        ? importedPersonalization.stickers
            .map((item) => cleanText(item, 10).toUpperCase())
            .filter(Boolean)
            .slice(0, 8)
        : ["WK"],
    };

    const keeperId = crypto.randomUUID();
    const now = new Date().toISOString();
    const trapperIdMap = new Map<string, string>();
    const trapperTitleMap = new Map<string, string>();
    const sourceIdMap = new Map<string, string>();
    const importedTrappers = arrayValue(body.trappers ?? [], 100).map((item) => {
      const oldId = cleanText(item.id, 120);
      const id = crypto.randomUUID();
      trapperIdMap.set(oldId, id);
      trapperTitleMap.set(oldId, cleanText(item.title, 100));
      return {
        id,
        title: cleanText(item.title, 100),
        objective: cleanText(item.objective, 1_200),
        riskLevel: risks.has(cleanText(item.riskLevel, 12))
          ? cleanText(item.riskLevel, 12)
          : "low",
        status: cleanText(item.status, 12) === "closed" ? "closed" : "open",
        contextCount: Math.max(0, Math.min(10_000, Number(item.contextCount) || 0)),
        sourceIds: Array.isArray(item.sourceIds)
          ? item.sourceIds.map((id) => cleanText(id, 120)).filter(Boolean).slice(0, 50)
          : [],
        createdAt: cleanText(item.createdAt, 40) || now,
        closedAt: cleanText(item.closedAt, 40) || null,
      };
    });
    const importedSources = arrayValue(body.sources ?? [], 200).map((item) => {
      const oldId = cleanText(item.id, 120);
      const id = crypto.randomUUID();
      sourceIdMap.set(oldId, id);
      const kind = cleanText(item.kind, 20);
      return {
        id,
        kind: sourceKinds.has(kind) ? kind : "note",
        title: cleanText(item.title, 120),
        summary: cleanText(item.summary, 4_000),
        url: item.url ? cleanUrl(item.url) : null,
        commitSha: /^[a-f0-9]{40}$/i.test(cleanText(item.commitSha, 40))
          ? cleanText(item.commitSha, 40).toLowerCase()
          : null,
        snapshot: cleanRepositorySnapshot(item.snapshot),
        fileName: cleanText(item.fileName, 240) || null,
        mimeType: cleanText(item.mimeType, 120) || null,
        contentExcerpt: cleanText(item.contentExcerpt, 12_000) || null,
        createdAt: cleanText(item.createdAt, 40) || now,
      };
    });
    for (const item of importedTrappers) {
      item.sourceIds = item.sourceIds
        .map((sourceId) => sourceIdMap.get(sourceId))
        .filter((sourceId): sourceId is string => Boolean(sourceId));
      item.contextCount = Math.max(item.contextCount, item.sourceIds.length);
    }
    const importedRelations = arrayValue(body.relations ?? [], 300)
      .map((item) => ({
        id: crypto.randomUUID(),
        fromSourceId: sourceIdMap.get(cleanText(item.fromSourceId, 120)),
        toSourceId: sourceIdMap.get(cleanText(item.toSourceId, 120)),
        label: cleanText(item.label, 42),
        createdAt: cleanText(item.createdAt, 40) || now,
      }))
      .filter(
        (item): item is {
          id: string;
          fromSourceId: string;
          toSourceId: string;
          label: string;
          createdAt: string;
        } =>
          Boolean(
            item.fromSourceId &&
              item.toSourceId &&
              item.fromSourceId !== item.toSourceId &&
              item.label,
          ),
      );
    const importedReceipts = arrayValue(body.receipts ?? [], 100)
      .map((item) => {
        const oldTrapperId = cleanText(item.trapperId, 120);
        const trapperId = trapperIdMap.get(oldTrapperId);
        const originalHash = cleanText(item.hash, 96);
        return {
          id: crypto.randomUUID(),
          trapperId,
          hash: "",
          payload: {
            contractVersion: "warper-keeper-imported-receipt/1",
            keeperId,
            trapperId,
            title: trapperTitleMap.get(oldTrapperId) || "Imported task receipt",
            result: "Imported with original proof attached",
            importedAt: now,
            originalHash,
            originalPayload: recordValue(item.payload ?? {}),
          },
          createdAt: cleanText(item.createdAt, 40) || now,
        };
      })
      .filter(
        (item): item is typeof item & { trapperId: string } =>
          Boolean(item.trapperId && item.payload.originalHash),
      );
    for (const receipt of importedReceipts) {
      receipt.hash = await sha256Value(receipt.payload);
    }
    const importedProofDrops = arrayValue(body.proofDrops ?? [], 100).map((item) => {
      const sourceIds = Array.isArray(item.sourceIds)
        ? item.sourceIds
            .map((id) => sourceIdMap.get(cleanText(id, 120)))
            .filter((id): id is string => Boolean(id))
            .slice(0, 50)
        : [];
      const envelope = {
        contractVersion: "warper-keeper-proof-drop/1",
        keeperId,
        title: cleanText(item.title, 120),
        purpose: cleanText(item.purpose, 1_000),
        sourceIds,
        importedAt: now,
      };
      return {
        id: crypto.randomUUID(),
        title: envelope.title,
        purpose: envelope.purpose,
        sourceIds,
        hash: "",
        envelope,
        createdAt: cleanText(item.createdAt, 40) || now,
      };
    });
    for (const drop of importedProofDrops) {
      drop.hash = await sha256Value(drop.envelope);
    }

    const statements = [
      env.DB.prepare("DELETE FROM receipts WHERE owner_fid = ?").bind(fid),
      env.DB.prepare("DELETE FROM context_items WHERE owner_fid = ?").bind(fid),
      env.DB.prepare("DELETE FROM trapper_shares WHERE owner_fid = ?").bind(fid),
      env.DB.prepare("DELETE FROM trapper_sources WHERE owner_fid = ?").bind(fid),
      env.DB.prepare("DELETE FROM trappers WHERE owner_fid = ?").bind(fid),
      env.DB.prepare("DELETE FROM proof_drops WHERE owner_fid = ?").bind(fid),
      env.DB.prepare("DELETE FROM source_relations WHERE owner_fid = ?").bind(fid),
      env.DB.prepare("DELETE FROM sources WHERE owner_fid = ?").bind(fid),
      env.DB.prepare("DELETE FROM keeper_personalization WHERE owner_fid = ?").bind(fid),
      env.DB.prepare("DELETE FROM keepers WHERE owner_fid = ?").bind(fid),
      env.DB.prepare(
        "INSERT INTO keepers (id, owner_fid, name, template, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(keeperId, fid, name, template, now, now),
      env.DB.prepare(
        `INSERT INTO keeper_personalization (
          keeper_id, owner_fid, theme, tagline, stickers_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(
        keeperId,
        fid,
        personalization.theme,
        personalization.tagline,
        JSON.stringify(personalization.stickers),
        now,
      ),
      ...importedTrappers.map((item) =>
        env.DB.prepare(
          `INSERT INTO trappers (
            id, keeper_id, owner_fid, title, objective, risk_level,
            status, context_count, created_at, closed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          item.id,
          keeperId,
          fid,
          item.title,
          item.objective,
          item.riskLevel,
          item.status,
          item.contextCount,
          item.createdAt,
          item.closedAt,
        ),
      ),
      ...importedSources.map((item) =>
        env.DB.prepare(
          `INSERT INTO sources (
            id, keeper_id, owner_fid, kind, title, summary, url, commit_sha,
            snapshot_json, file_name, mime_type, content_excerpt, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          item.id,
          keeperId,
          fid,
          item.kind,
          item.title,
          item.summary,
          item.url,
          item.commitSha,
          item.snapshot ? JSON.stringify(item.snapshot) : null,
          item.fileName,
          item.mimeType,
          item.contentExcerpt,
          item.createdAt,
        ),
      ),
      ...importedTrappers.flatMap((item) =>
        item.sourceIds.map((sourceId) =>
          env.DB.prepare(
            `INSERT INTO trapper_sources (
              id, trapper_id, source_id, owner_fid, created_at
            ) VALUES (?, ?, ?, ?, ?)`,
          ).bind(crypto.randomUUID(), item.id, sourceId, fid, item.createdAt),
        ),
      ),
      ...importedRelations.map((item) =>
        env.DB.prepare(
          `INSERT INTO source_relations (
            id, keeper_id, owner_fid, from_source_id, to_source_id, label, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          item.id,
          keeperId,
          fid,
          item.fromSourceId,
          item.toSourceId,
          item.label,
          item.createdAt,
        ),
      ),
      ...importedReceipts.map((item) =>
        env.DB.prepare(
          `INSERT INTO receipts (
            id, trapper_id, owner_fid, hash, payload_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(
          item.id,
          item.trapperId,
          fid,
          item.hash,
          JSON.stringify(item.payload),
          item.createdAt,
        ),
      ),
      ...importedProofDrops.map((item) =>
        env.DB.prepare(
          `INSERT INTO proof_drops (
            id, keeper_id, owner_fid, title, purpose, source_ids_json,
            hash, envelope_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          item.id,
          keeperId,
          fid,
          item.title,
          item.purpose,
          JSON.stringify(item.sourceIds),
          item.hash,
          JSON.stringify(item.envelope),
          item.createdAt,
        ),
      ),
    ];
    await env.DB.batch(statements);
    return json(await stateFor(env.DB, fid), 201);
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/miniapp/personalization"
  ) {
    const body = await readJson(request);
    const keeperId = cleanText(body.keeperId, 120);
    const theme = cleanText(body.theme, 20);
    const tagline = cleanText(body.tagline, 80);
    const stickers = Array.isArray(body.stickers)
      ? body.stickers
          .map((item) => cleanText(item, 10).toUpperCase())
          .filter(Boolean)
          .slice(0, 8)
      : [];
    if (!keeperId || !themes.has(theme)) {
      return json({ error: "Keeper personalization is invalid" }, 400);
    }
    const keeper = await env.DB.prepare(
      "SELECT id FROM keepers WHERE id = ? AND owner_fid = ?",
    )
      .bind(keeperId, fid)
      .first();
    if (!keeper) return json({ error: "Keeper not found" }, 404);

    const updatedAt = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO keeper_personalization (
        keeper_id, owner_fid, theme, tagline, stickers_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_fid) DO UPDATE SET
        keeper_id = excluded.keeper_id,
        theme = excluded.theme,
        tagline = excluded.tagline,
        stickers_json = excluded.stickers_json,
        updated_at = excluded.updated_at`,
    )
      .bind(keeperId, fid, theme, tagline, JSON.stringify(stickers), updatedAt)
      .run();
    return json(
      {
        personalization: {
          theme,
          tagline,
          stickers,
        },
      },
      201,
    );
  }

  if (request.method === "POST" && url.pathname === "/api/miniapp/keepers") {
    const body = await readJson(request);
    const name = cleanText(body.name, 42);
    const template = cleanText(body.template, 20);
    if (!name || !templates.has(template)) {
      return json({ error: "Valid name and template required" }, 400);
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO keepers (id, owner_fid, name, template, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_fid) DO UPDATE SET
         name = excluded.name,
         template = excluded.template,
         updated_at = excluded.updated_at`,
    )
      .bind(id, fid, name, template, now, now)
      .run();
    const state = await stateFor(env.DB, fid);
    return json({ keeper: state.keeper }, 201);
  }

  if (request.method === "POST" && url.pathname === "/api/miniapp/trappers") {
    const body = await readJson(request);
    const keeperId = cleanText(body.keeperId, 80);
    const title = cleanText(body.title, 100);
    const objective = cleanText(body.objective, 1_200);
    const riskLevel = cleanText(body.riskLevel, 12);
    const sourceIds = Array.isArray(body.sourceIds)
      ? [...new Set(body.sourceIds.map((id) => cleanText(id, 120)).filter(Boolean))].slice(
          0,
          50,
        )
      : [];
    if (!keeperId || !title || !objective || !risks.has(riskLevel)) {
      return json({ error: "Task fields are incomplete" }, 400);
    }
    const keeper = await env.DB.prepare(
      "SELECT id FROM keepers WHERE id = ? AND owner_fid = ?",
    )
      .bind(keeperId, fid)
      .first();
    if (!keeper) return json({ error: "Keeper not found" }, 404);
    if (sourceIds.length) {
      const placeholders = sourceIds.map(() => "?").join(",");
      const selected = await env.DB.prepare(
        `SELECT id FROM sources
         WHERE owner_fid = ? AND keeper_id = ? AND id IN (${placeholders})`,
      )
        .bind(fid, keeperId, ...sourceIds)
        .all();
      if (selected.results.length !== sourceIds.length) {
        return json({ error: "Every Trapper source must belong to this Keeper" }, 400);
      }
    }

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await env.DB.batch([
      env.DB
        .prepare(
          `INSERT INTO trappers (
            id, keeper_id, owner_fid, title, objective, risk_level,
            status, context_count, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
        )
        .bind(
          id,
          keeperId,
          fid,
          title,
          objective,
          riskLevel,
          sourceIds.length,
          createdAt,
        ),
      ...sourceIds.map((sourceId) =>
        env.DB
          .prepare(
            `INSERT INTO trapper_sources (
              id, trapper_id, source_id, owner_fid, created_at
            ) VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(crypto.randomUUID(), id, sourceId, fid, createdAt),
      ),
    ]);
    const row = await env.DB.prepare(
      "SELECT * FROM trappers WHERE id = ? AND owner_fid = ?",
    )
      .bind(id, fid)
      .first<Record<string, unknown>>();
    return json({ trapper: trapperFromRow(row!, sourceIds) }, 201);
  }

  if (request.method === "POST" && url.pathname === "/api/miniapp/sources") {
    const body = await readJson(request);
    const keeperId = cleanText(body.keeperId, 120);
    const kind = cleanText(body.kind, 20);
    const title = cleanText(body.title, 120);
    const summary = cleanText(body.summary, 4_000);
    if (!keeperId || !sourceKinds.has(kind) || !title || !summary) {
      return json({ error: "Source fields are incomplete" }, 400);
    }
    const keeper = await env.DB.prepare(
      "SELECT id FROM keepers WHERE id = ? AND owner_fid = ?",
    )
      .bind(keeperId, fid)
      .first();
    if (!keeper) return json({ error: "Keeper not found" }, 404);

    let sourceUrl: string | null = null;
    let commitSha: string | null = null;
    let snapshot: Record<string, unknown> | null = null;
    let fileName: string | null = null;
    let mimeType: string | null = null;
    let contentExcerpt: string | null = null;
    if (kind === "repository") {
      const repository = await inspectPublicGitHub(body.url);
      sourceUrl = repository.canonicalUrl;
      commitSha = repository.commitSha;
      snapshot = repository.snapshot;
    } else if (kind === "link") {
      sourceUrl = cleanUrl(body.url);
      if (!sourceUrl) return json({ error: "Source URL is required" }, 400);
    } else if (kind === "file") {
      fileName = cleanText(body.fileName, 240);
      mimeType = cleanText(body.mimeType, 120) || "application/octet-stream";
      contentExcerpt = cleanText(body.contentExcerpt, 12_000) || null;
      if (!fileName) return json({ error: "File name is required" }, 400);
    }

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO sources (
        id, keeper_id, owner_fid, kind, title, summary, url, commit_sha,
        snapshot_json, file_name, mime_type, content_excerpt, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        keeperId,
        fid,
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
      )
      .run();
    const row = await env.DB.prepare(
      "SELECT * FROM sources WHERE id = ? AND owner_fid = ?",
    )
      .bind(id, fid)
      .first<Record<string, unknown>>();
    return json({ source: sourceFromRow(row!) }, 201);
  }

  if (request.method === "POST" && url.pathname === "/api/miniapp/relations") {
    const body = await readJson(request);
    const keeperId = cleanText(body.keeperId, 120);
    const fromSourceId = cleanText(body.fromSourceId, 120);
    const toSourceId = cleanText(body.toSourceId, 120);
    const label = cleanText(body.label, 42);
    if (
      !keeperId ||
      !fromSourceId ||
      !toSourceId ||
      fromSourceId === toSourceId ||
      !label
    ) {
      return json({ error: "Connection fields are incomplete" }, 400);
    }
    const sources = await env.DB.prepare(
      `SELECT id FROM sources
       WHERE owner_fid = ? AND keeper_id = ? AND id IN (?, ?)`,
    )
      .bind(fid, keeperId, fromSourceId, toSourceId)
      .all();
    if (sources.results.length !== 2) {
      return json({ error: "Both sources must belong to this Keeper" }, 400);
    }
    const duplicate = await env.DB.prepare(
      `SELECT id FROM source_relations
       WHERE owner_fid = ? AND keeper_id = ?
         AND from_source_id = ? AND to_source_id = ? AND label = ?`,
    )
      .bind(fid, keeperId, fromSourceId, toSourceId, label)
      .first();
    if (duplicate) return json({ error: "Connection already exists" }, 409);

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO source_relations (
        id, keeper_id, owner_fid, from_source_id, to_source_id, label, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, keeperId, fid, fromSourceId, toSourceId, label, createdAt)
      .run();
    return json(
      {
        relation: {
          id,
          keeperId,
          fromSourceId,
          toSourceId,
          label,
          createdAt,
        },
      },
      201,
    );
  }

  if (request.method === "POST" && url.pathname === "/api/miniapp/proof-drops") {
    const body = await readJson(request);
    const keeperId = cleanText(body.keeperId, 120);
    const title = cleanText(body.title, 120);
    const purpose = cleanText(body.purpose, 1_000);
    const sourceIds = Array.isArray(body.sourceIds)
      ? [...new Set(body.sourceIds.map((id) => cleanText(id, 120)).filter(Boolean))].slice(
          0,
          50,
        )
      : [];
    if (!keeperId || !title || !purpose || sourceIds.length === 0) {
      return json({ error: "Context pack fields are incomplete" }, 400);
    }
    const placeholders = sourceIds.map(() => "?").join(",");
    const selected = await env.DB.prepare(
      `SELECT * FROM sources
       WHERE owner_fid = ? AND keeper_id = ? AND id IN (${placeholders})`,
    )
      .bind(fid, keeperId, ...sourceIds)
      .all<Record<string, unknown>>();
    if (selected.results.length !== sourceIds.length) {
      return json({ error: "Every source must belong to this Keeper" }, 400);
    }
    const createdAt = new Date().toISOString();
    const envelope = {
      contractVersion: "warper-keeper-proof-drop/1",
      keeperId,
      title,
      purpose,
      sources: selected.results
        .map(sourceFromRow)
        .map(({ id, kind, title: sourceTitle, url: sourceUrl, commitSha: sha }) => ({
          id,
          kind,
          title: sourceTitle,
          ...(sourceUrl ? { url: sourceUrl } : {}),
          ...(sha ? { commitSha: sha } : {}),
        }))
        .sort((a, b) => String(a.id).localeCompare(String(b.id))),
      createdAt,
    };
    const id = crypto.randomUUID();
    const hash = await sha256Value(envelope);
    await env.DB.prepare(
      `INSERT INTO proof_drops (
        id, keeper_id, owner_fid, title, purpose, source_ids_json,
        hash, envelope_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        keeperId,
        fid,
        title,
        purpose,
        JSON.stringify(sourceIds),
        hash,
        JSON.stringify(envelope),
        createdAt,
      )
      .run();
    return json(
      {
        proofDrop: {
          id,
          keeperId,
          title,
          purpose,
          sourceIds,
          hash,
          envelope,
          createdAt,
        },
      },
      201,
    );
  }

  const trapperSourceMatch = url.pathname.match(
    /^\/api\/miniapp\/trappers\/([^/]+)\/sources$/,
  );
  if (request.method === "POST" && trapperSourceMatch) {
    const body = await readJson(request);
    const trapperId = decodeURIComponent(trapperSourceMatch[1]);
    const sourceId = cleanText(body.sourceId, 120);
    if (!sourceId) return json({ error: "Source is required" }, 400);
    const pair = await env.DB.prepare(
      `SELECT t.id AS trapper_id, s.id AS source_id
       FROM trappers t
       JOIN sources s ON s.keeper_id = t.keeper_id AND s.owner_fid = t.owner_fid
       WHERE t.id = ? AND s.id = ? AND t.owner_fid = ? AND t.status = 'open'`,
    )
      .bind(trapperId, sourceId, fid)
      .first();
    if (!pair) return json({ error: "Open Trapper or source not found" }, 404);
    const duplicate = await env.DB.prepare(
      "SELECT id FROM trapper_sources WHERE trapper_id = ? AND source_id = ?",
    )
      .bind(trapperId, sourceId)
      .first();
    if (duplicate) return json({ error: "Source is already in this Trapper" }, 409);
    const createdAt = new Date().toISOString();
    await env.DB.batch([
      env.DB
        .prepare(
          `INSERT INTO trapper_sources (
            id, trapper_id, source_id, owner_fid, created_at
          ) VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), trapperId, sourceId, fid, createdAt),
      env.DB
        .prepare(
          "UPDATE trappers SET context_count = context_count + 1 WHERE id = ? AND owner_fid = ?",
        )
        .bind(trapperId, fid),
    ]);
    return json({ ok: true, trapperId, sourceId }, 201);
  }

  const contextMatch = url.pathname.match(
    /^\/api\/miniapp\/trappers\/([^/]+)\/context$/,
  );
  if (request.method === "POST" && contextMatch) {
    const body = await readJson(request);
    const content = cleanText(body.content, 4_000);
    if (!content) return json({ error: "Context is required" }, 400);
    const trapperId = decodeURIComponent(contextMatch[1]);
    const trapper = await env.DB.prepare(
      "SELECT id FROM trappers WHERE id = ? AND owner_fid = ? AND status = 'open'",
    )
      .bind(trapperId, fid)
      .first();
    if (!trapper) return json({ error: "Open task not found" }, 404);
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB
        .prepare(
          "INSERT INTO context_items (id, trapper_id, owner_fid, content, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(crypto.randomUUID(), trapperId, fid, content, now),
      env.DB
        .prepare(
          "UPDATE trappers SET context_count = context_count + 1 WHERE id = ? AND owner_fid = ?",
        )
        .bind(trapperId, fid),
    ]);
    return json({ ok: true }, 201);
  }

  const shareMatch = url.pathname.match(
    /^\/api\/miniapp\/trappers\/([^/]+)\/share$/,
  );
  if (request.method === "POST" && shareMatch) {
    const trapperId = decodeURIComponent(shareMatch[1]);
    const trapper = await env.DB.prepare(
      "SELECT * FROM trappers WHERE id = ? AND owner_fid = ?",
    )
      .bind(trapperId, fid)
      .first<Record<string, unknown>>();
    if (!trapper) return json({ error: "Trapper not found" }, 404);
    const linkedSources = await env.DB.prepare(
      `SELECT s.* FROM sources s
       JOIN trapper_sources ts ON ts.source_id = s.id
       WHERE ts.trapper_id = ? AND ts.owner_fid = ?
       ORDER BY ts.created_at ASC`,
    )
      .bind(trapperId, fid)
      .all<Record<string, unknown>>();
    const receipt = await env.DB.prepare(
      "SELECT * FROM receipts WHERE trapper_id = ? AND owner_fid = ? ORDER BY created_at DESC LIMIT 1",
    )
      .bind(trapperId, fid)
      .first<Record<string, unknown>>();
    const exportedAt = new Date().toISOString();
    const bundle = {
      contractVersion: "warper-keeper-trapper/1",
      trapper: {
        id: trapper.id,
        title: trapper.title,
        objective: trapper.objective,
        riskLevel: trapper.risk_level,
        status: trapper.status,
        createdAt: trapper.created_at,
        closedAt: trapper.closed_at ? String(trapper.closed_at) : null,
      },
      sources: linkedSources.results.map(sourceFromRow),
      ...(receipt ? { receipt: receiptFromRow(receipt) } : {}),
      creator: { fid },
      exportedAt,
      schemaVersion: 1,
      privacyClassification: "private",
      capabilities: [],
      permissions: {
        maxContextItems: 50,
        maxSourceBytes: 1_048_576,
        allowedDomains: [],
        maxExecutionSeconds: 300,
      },
      expiry: null,
      revocation: null,
    };
    const token = `${crypto.randomUUID().replaceAll("-", "")}${crypto
      .randomUUID()
      .replaceAll("-", "")}`;
    await env.DB.prepare(
      `INSERT INTO trapper_shares (
        token, trapper_id, keeper_id, owner_fid, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        token,
        trapperId,
        String(trapper.keeper_id),
        fid,
        JSON.stringify(bundle),
        exportedAt,
      )
      .run();
    return json(
      {
        token,
        url: `${url.origin}${url.pathname.startsWith("/api/") ? "/" : url.pathname}?share=${token}`,
      },
      201,
    );
  }

  const closeMatch = url.pathname.match(
    /^\/api\/miniapp\/trappers\/([^/]+)\/close$/,
  );
  if (request.method === "POST" && closeMatch) {
    const trapperId = decodeURIComponent(closeMatch[1]);
    const row = await env.DB.prepare(
      "SELECT * FROM trappers WHERE id = ? AND owner_fid = ? AND status = 'open'",
    )
      .bind(trapperId, fid)
      .first<Record<string, unknown>>();
    if (!row) return json({ error: "Open task not found" }, 404);

    const closedAt = new Date().toISOString();
    const receiptId = crypto.randomUUID();
    const linkedSources = await env.DB.prepare(
      "SELECT source_id FROM trapper_sources WHERE trapper_id = ? AND owner_fid = ? ORDER BY created_at ASC",
    )
      .bind(trapperId, fid)
      .all<Record<string, unknown>>();
    const sourceIds = linkedSources.results.map((item) => String(item.source_id));
    const payload = {
      contractVersion: "warper-keeper-receipt/1",
      receiptId,
      ownerFid: fid,
      keeperId: row.keeper_id,
      trapperId,
      title: row.title,
      objective: row.objective,
      contextCount: row.context_count,
      sourceIds,
      sourceCount: sourceIds.length,
      completedAt: closedAt,
      result: "Task closed by owner",
    };
    const payloadJson = JSON.stringify(payload);
    const hash = await sha256Value(payload);
    await env.DB.batch([
      env.DB
        .prepare(
          "UPDATE trappers SET status = 'closed', closed_at = ? WHERE id = ? AND owner_fid = ?",
        )
        .bind(closedAt, trapperId, fid),
      env.DB
        .prepare(
          "INSERT INTO receipts (id, trapper_id, owner_fid, hash, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(receiptId, trapperId, fid, hash, payloadJson, closedAt),
    ]);

    return json({
      trapper: trapperFromRow(
        { ...row, status: "closed", closed_at: closedAt },
        sourceIds,
      ),
      receipt: {
        id: receiptId,
        trapperId,
        hash,
        payload,
        createdAt: closedAt,
      },
    });
  }

  return json({ error: "Not found" }, 404);
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      try {
        const response = await handleApi(request, env);
        if (response) return response;
      } catch (error) {
        console.error("warper_keeper_api_error", error);
        return json({ error: "Request could not be completed" }, 500);
      }
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(
        request,
        {
          fetchAsset: (path) =>
            env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES.input(body)
              .transform(width > 0 ? { width } : {})
              .output({ format, quality });
            return result.response();
          },
        },
        allowedWidths,
      );
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
