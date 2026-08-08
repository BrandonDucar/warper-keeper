# Warper Keeper Agent Delegation v1

Warper Keeper remains user-owned. External agents are delegates with finite,
revocable access to explicit Keepers and operations. A grant never implies
proof certification, public sharing, deletion, wallet authority, or access to
another Keeper.

## Authorization Model

```text
Farcaster owner consent
        |
        v
Cloudflare D1 agent grant
        |
        +-- wk_agent_* bearer token
        |
        +-- signed Spore gateway assertion
        |
        v
same Keeper / Trapper / Source ACL
```

Every grant contains a stable owner FID, `tenantId`, `agentId`, explicit
`keeperIds`, explicit permissions, issue time, finite expiry, and optional
revocation time. Creating a replacement grant for the same owner and agent
revokes the older grant and its tokens. Direct tokens are returned once and
stored only as SHA-256 hashes.

Supported permissions are:

- `keeper:read`
- `trapper:read`
- `trapper:write`
- `source:read`
- `source:add`
- `artifact:add`
- `receipt:create`

Everything else is denied. In particular, there is no agent route for grant
administration, Keeper deletion, public sharing, Proof Drop certification, or
credential issuance.

## Owner Routes

Owner routes require Farcaster Quick Auth. Every mutating route also requires
an `Idempotency-Key` header containing 8-128 letters, numbers, `.`, `_`, `:`, or
`-`.

```text
GET  /api/miniapp/agent-grants
POST /api/miniapp/agent-grants
POST /api/miniapp/agent-grants/:grantId/renew
POST /api/miniapp/agent-grants/:grantId/rotate
POST /api/miniapp/agent-grants/:grantId/revoke
```

Example grant request:

```json
{
  "tenantId": "gundarium",
  "agentId": "larry",
  "keeperIds": ["gundarium-launch"],
  "permissions": [
    "keeper:read",
    "trapper:read",
    "trapper:write",
    "source:read",
    "source:add",
    "artifact:add",
    "receipt:create"
  ],
  "expiresAt": "2026-09-08T00:00:00.000Z",
  "issueDirectToken": true
}
```

Grant lifetimes default to 30 days and must remain between 5 minutes and 90
days. `expiresAt: null` is rejected. The `wk_agent_*` token in the response is
shown once.

## Agent Routes

Read routes:

```text
GET /api/agent/session
GET /api/agent/keepers
GET /api/agent/keepers/:keeperId
GET /api/agent/trappers?keeperId=:keeperId
GET /api/agent/trappers/:trapperId
GET /api/agent/sources?keeperId=:keeperId
```

Write routes require an `Idempotency-Key` and return a deterministic,
tamper-evident write receipt:

```text
POST /api/agent/trappers
POST /api/agent/sources
POST /api/agent/trappers/:trapperId/context
POST /api/agent/trappers/:trapperId/sources
POST /api/agent/trappers/:trapperId/artifacts
POST /api/agent/trappers/:trapperId/receipts
```

Artifacts are references, not uploaded executable blobs. They require a
`sha256:<64 lowercase hex>` content hash and may include a public HTTPS URI.
Agent result receipts must set `selfAttested: true`; the stored contract always
sets `certification: "none"`. Unknown verdict or verification fields are
rejected.

Each grant is also protected by a D1 fixed-window limiter. Defaults are 120
reads and 30 writes per minute; deployments may lower them with
`AGENT_READ_RATE_LIMIT` and `AGENT_WRITE_RATE_LIMIT`.

## Direct Authentication

```http
Authorization: Bearer wk_agent_<one-time-secret>
Idempotency-Key: larry-context-0001
```

## Spore Authentication

Set `SPORE_GATEWAY_HMAC_SECRET` as a secret on Warper Keeper and the trusted
Spore Federation Gateway. It must be at least 32 characters. The gateway sends:

```text
X-Warper-Spore-Grant-Id
X-Warper-Spore-Tenant-Id
X-Warper-Spore-Agent-Id
X-Warper-Spore-Lease-Id
X-Warper-Spore-Issued-At
X-Warper-Spore-Expires-At
X-Warper-Spore-Request-Id
X-Warper-Spore-Signature
```

The lowercase hexadecimal HMAC-SHA256 signature covers this exact string:

```text
WARPER-SPORE-AUTH-V1
HTTP_METHOD
/path?query
grantId
tenantId
agentId
leaseId
issuedAt
expiresAt
requestId
sha256_hex_of_raw_body
```

Assertions may live for at most five minutes, allow at most one minute of clock
skew, and use a D1 replay nonce. Spore proves the caller identity and lease;
the D1 grant remains the final authority over user data.

## Evidence Boundary

Agent writes produce `warper-keeper-agent-write-receipt/1` envelopes containing
the grant, owner, tenant, agent, authentication mode, action, resource, request
idempotency key, payload hash, and timestamp. Raw bearer credentials are never
stored. Receipts prove what Warper Keeper accepted; independent Claim Factory
or quorum verification is still required before a claim or competency can be
certified.

## Deployment Gate

Apply `drizzle/0005_square_luke_cage.sql`, configure the HMAC secret only when
a trusted Spore gateway is ready, and run the full test suite. Do not issue a
partner token or expose a Spore route until the exact deployment commit has
passed DreamNet quorum review.
