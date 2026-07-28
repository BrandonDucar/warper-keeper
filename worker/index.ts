import { createClient } from "@farcaster/quick-auth";
import {
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
  handleImageOptimization,
} from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

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
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const quickAuth = createClient();
const gatewayUrl =
  "https://warper-keeper-agent-gateway-production.up.railway.app/healthz";
const templates = new Set(["project", "research", "content", "operations"]);
const risks = new Set(["low", "medium", "high"]);

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

async function readJson(request: Request) {
  const text = await request.text();
  if (text.length > 32_000) throw new Error("Request is too large");
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
    db.prepare(
      "CREATE INDEX IF NOT EXISTS trappers_owner_idx ON trappers(owner_fid, created_at)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS receipts_owner_idx ON receipts(owner_fid, created_at)",
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

function trapperFromRow(row: Record<string, unknown>) {
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

function receiptFromRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    trapperId: row.trapper_id,
    hash: row.hash,
    payload: JSON.parse(String(row.payload_json)),
    createdAt: row.created_at,
  };
}

async function stateFor(db: D1Database, fid: number) {
  const [keeper, trappers, receipts] = await Promise.all([
    db
      .prepare("SELECT * FROM keepers WHERE owner_fid = ? LIMIT 1")
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
  ]);
  return {
    keeper: keeperFromRow(keeper),
    trappers: trappers.results.map(trapperFromRow),
    receipts: receipts.results.map(receiptFromRow),
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

async function handleApi(request: Request, env: Env) {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/api/gateway-health") {
    try {
      const response = await fetch(gatewayUrl, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(4_000),
      });
      return json({ ok: response.ok, gateway: "warper-keeper" }, response.ok ? 200 : 503);
    } catch {
      return json({ ok: false, gateway: "warper-keeper" }, 503);
    }
  }

  if (!url.pathname.startsWith("/api/miniapp/")) return null;
  const fid = await ownerFid(request);
  if (!fid) return json({ error: "Farcaster authentication required" }, 401);
  await ensureSchema(env.DB);

  if (request.method === "GET" && url.pathname === "/api/miniapp/state") {
    return json(await stateFor(env.DB, fid));
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
    if (!keeperId || !title || !objective || !risks.has(riskLevel)) {
      return json({ error: "Task fields are incomplete" }, 400);
    }
    const keeper = await env.DB.prepare(
      "SELECT id FROM keepers WHERE id = ? AND owner_fid = ?",
    )
      .bind(keeperId, fid)
      .first();
    if (!keeper) return json({ error: "Keeper not found" }, 404);

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO trappers (
        id, keeper_id, owner_fid, title, objective, risk_level,
        status, context_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'open', 0, ?)`,
    )
      .bind(id, keeperId, fid, title, objective, riskLevel, createdAt)
      .run();
    const row = await env.DB.prepare(
      "SELECT * FROM trappers WHERE id = ? AND owner_fid = ?",
    )
      .bind(id, fid)
      .first<Record<string, unknown>>();
    return json({ trapper: trapperFromRow(row!) }, 201);
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
    const payload = {
      contractVersion: "warper-keeper-receipt/1",
      receiptId,
      ownerFid: fid,
      keeperId: row.keeper_id,
      trapperId,
      objective: row.objective,
      contextCount: row.context_count,
      completedAt: closedAt,
      result: "Task closed by owner",
    };
    const payloadJson = JSON.stringify(payload);
    const hash = await sha256(payloadJson);
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
      trapper: trapperFromRow({ ...row, status: "closed", closed_at: closedAt }),
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
