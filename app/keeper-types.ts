export type KeeperTemplate = "project" | "research" | "content" | "operations";
export type KeeperTheme = "signal" | "voltage" | "archive";
export type RiskLevel = "low" | "medium" | "high";
export type SourceKind = "note" | "link" | "repository";

export type Keeper = {
  id: string;
  name: string;
  template: KeeperTemplate;
  createdAt: string;
};

export type Trapper = {
  id: string;
  keeperId: string;
  title: string;
  objective: string;
  riskLevel: RiskLevel;
  status: "open" | "closed";
  contextCount: number;
  createdAt: string;
  closedAt?: string;
};

export type Receipt = {
  id: string;
  trapperId: string;
  hash: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type SourceItem = {
  id: string;
  keeperId: string;
  kind: SourceKind;
  title: string;
  summary: string;
  url?: string;
  commitSha?: string;
  createdAt: string;
};

export type SourceRelation = {
  id: string;
  keeperId: string;
  fromSourceId: string;
  toSourceId: string;
  label: string;
  createdAt: string;
};

export type ProofDrop = {
  id: string;
  keeperId: string;
  title: string;
  purpose: string;
  sourceIds: string[];
  hash: string;
  envelope: Record<string, unknown>;
  createdAt: string;
};

export type KeeperPersonalization = {
  theme: KeeperTheme;
  tagline: string;
  stickers: string[];
};

export type KeeperState = {
  keeper: Keeper | null;
  personalization: KeeperPersonalization;
  trappers: Trapper[];
  receipts: Receipt[];
  sources: SourceItem[];
  relations: SourceRelation[];
  proofDrops: ProofDrop[];
};

export const defaultPersonalization: KeeperPersonalization = {
  theme: "signal",
  tagline: "Working context, ready to move.",
  stickers: ["WK"],
};

export const emptyKeeperState: KeeperState = {
  keeper: null,
  personalization: defaultPersonalization,
  trappers: [],
  receipts: [],
  sources: [],
  relations: [],
  proofDrops: [],
};

export function normalizeKeeperState(value: unknown): KeeperState {
  if (!value || typeof value !== "object") return emptyKeeperState;
  const candidate = value as Partial<KeeperState>;
  const personalization = candidate.personalization;
  const theme =
    personalization?.theme === "voltage" || personalization?.theme === "archive"
      ? personalization.theme
      : "signal";
  return {
    keeper: candidate.keeper ?? null,
    personalization: {
      theme,
      tagline:
        typeof personalization?.tagline === "string"
          ? personalization.tagline.slice(0, 80)
          : defaultPersonalization.tagline,
      stickers: Array.isArray(personalization?.stickers)
        ? personalization.stickers
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim().slice(0, 10))
            .filter(Boolean)
            .slice(0, 8)
        : defaultPersonalization.stickers,
    },
    trappers: Array.isArray(candidate.trappers) ? candidate.trappers : [],
    receipts: Array.isArray(candidate.receipts) ? candidate.receipts : [],
    sources: Array.isArray(candidate.sources) ? candidate.sources : [],
    relations: Array.isArray(candidate.relations) ? candidate.relations : [],
    proofDrops: Array.isArray(candidate.proofDrops) ? candidate.proofDrops : [],
  };
}
