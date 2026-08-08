export const AGENT_TOKEN_PREFIX: "wk_agent_";
export const AGENT_PERMISSIONS: readonly AgentPermission[];

export type AgentPermission =
  | "artifact:add"
  | "keeper:read"
  | "receipt:create"
  | "source:add"
  | "source:read"
  | "trapper:read"
  | "trapper:write";

export type AgentGrant = {
  grantId: string;
  ownerFid: number;
  ownerId: string;
  tenantId: string;
  agentId: string;
  keeperIds: string[];
  permissions: AgentPermission[];
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  active: boolean;
};

export type SporeAssertion = {
  grantId: string;
  tenantId: string;
  agentId: string;
  leaseId: string;
  issuedAt: string;
  expiresAt: string;
  requestId: string;
  signature: string;
};

export function normalizeIdentity(value: unknown, code: string): string;
export function normalizeId(value: unknown, code: string): string;
export function normalizeAgentGrant(
  input: unknown,
  ownerKeeperIds: string[],
  now?: Date,
): Pick<AgentGrant, "tenantId" | "agentId" | "keeperIds" | "permissions" | "expiresAt">;
export function normalizeGrantRenewal(input: unknown, now?: Date): string;
export function parseGrantRow(row: Record<string, unknown>, now?: Date): AgentGrant;
export function createAgentToken(): string;
export function sha256Hex(value: string): Promise<string>;
export function hashAgentToken(token: string): Promise<string>;
export function bearerAgentToken(request: Request): string | null;
export function requireIdempotencyKey(request: Request): string;
export function assertPermission(grant: AgentGrant, permission: AgentPermission): void;
export function assertKeeperAccess(grant: AgentGrant, keeperId: string): void;
export function sporeAssertionFromHeaders(request: Request): SporeAssertion;
export function validateSporeAssertionWindow(assertion: SporeAssertion, now?: Date): void;
export function sporeAssertionMessage(input: {
  request: Request;
  assertion: SporeAssertion;
  bodyHash: string;
}): string;
export function hmacSha256Hex(secret: string, value: string): Promise<string>;
export function verifySporeAssertion(input: {
  request: Request;
  assertion: SporeAssertion;
  bodyHash: string;
  secret: string;
  now?: Date;
}): Promise<SporeAssertion>;
