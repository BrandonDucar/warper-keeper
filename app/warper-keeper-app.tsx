"use client";

import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  CircleDot,
  Download,
  FileCheck2,
  FolderKanban,
  Layers3,
  Library,
  PackageOpen,
  Palette,
  Plus,
  Radio,
  ReceiptText,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  KeeperLibrary,
  ProofDropList,
  type AddSourceInput,
} from "./keeper-library";
import { KeeperPersonalize } from "./keeper-personalize";
import { KeeperWorkspace } from "./keeper-workspace";
import {
  defaultPersonalization,
  emptyKeeperState,
  normalizeKeeperState,
  type Keeper,
  type KeeperPersonalization,
  type KeeperState,
  type KeeperTemplate,
  type ProofDrop,
  type Receipt,
  type RiskLevel,
  type SourceItem,
  type SourceRelation,
  type Trapper,
  type TrapperBundle,
} from "./keeper-types";
import { sha256Canonical } from "./proof-envelope";

type ViewName = "workspace" | "trappers" | "library" | "proof";

type Profile = {
  fid?: number;
  username?: string;
  displayName: string;
  pfpUrl?: string;
};

type MiniAppSdk = typeof import("@farcaster/miniapp-sdk").sdk;

const previewStorageKey = "warper-keeper-preview-state-v1";

const templateOptions: Array<{
  id: KeeperTemplate;
  name: string;
  detail: string;
}> = [
  { id: "project", name: "Build a project", detail: "Plans, files, tasks, and proof" },
  { id: "research", name: "Research a subject", detail: "Sources, claims, and findings" },
  { id: "content", name: "Run a content desk", detail: "Drafts, approvals, and publishing" },
  { id: "operations", name: "Operate a business", detail: "Workflows, handoffs, and receipts" },
];

const sampleState: KeeperState = {
  keeper: {
    id: "keeper-sample",
    name: "Launch Desk",
    template: "project",
    createdAt: "2026-07-28T12:00:00.000Z",
  },
  personalization: {
    theme: "voltage",
    tagline: "Bound work. Live context. Portable proof.",
    stickers: ["WK", "PROOF", "✦"],
  },
  trappers: [
    {
      id: "trapper-sample-active",
      keeperId: "keeper-sample",
      title: "Prepare launch package",
      objective: "Check the Mini App, final copy, and public links before launch.",
      riskLevel: "medium",
      status: "open",
      contextCount: 4,
      sourceIds: [
        "source-product-brief",
        "source-public-repo",
        "source-launch-checklist",
      ],
      createdAt: "2026-07-28T13:10:00.000Z",
    },
    {
      id: "trapper-sample-closed",
      keeperId: "keeper-sample",
      title: "Verify production build",
      objective: "Confirm the public build and health endpoint are available.",
      riskLevel: "low",
      status: "closed",
      contextCount: 3,
      sourceIds: ["source-public-repo", "source-launch-checklist"],
      createdAt: "2026-07-28T12:20:00.000Z",
      closedAt: "2026-07-28T12:48:00.000Z",
    },
  ],
  receipts: [
    {
      id: "receipt-sample",
      trapperId: "trapper-sample-closed",
      hash: "sha256:71d4a089...9ca2",
       payload: {
         contractVersion: "warper-keeper-receipt/1",
         title: "Verify production build",
         result: "Production build verified",
         evidenceCount: 3,
      },
      createdAt: "2026-07-28T12:48:00.000Z",
    },
  ],
  sources: [
    {
      id: "source-product-brief",
      keeperId: "keeper-sample",
      kind: "note",
      title: "Product brief",
      summary:
        "Warper Keeper keeps agent objectives, source context, boundaries, outputs, and proof together.",
      createdAt: "2026-07-28T12:04:00.000Z",
    },
    {
      id: "source-public-repo",
      keeperId: "keeper-sample",
      kind: "repository",
      title: "BrandonDucar/warper-keeper",
      summary:
        "Public Mini App source pinned to the launch candidate commit.",
      url: "https://github.com/BrandonDucar/warper-keeper",
      commitSha: "bf3d8310b40a657da374dfedab5caf0f39bff15a",
      snapshot: {
        owner: "BrandonDucar",
        repository: "warper-keeper",
        defaultBranch: "master",
        commitSha: "bf3d8310b40a657da374dfedab5caf0f39bff15a",
        fileCount: 38,
        files: [
          "README.md",
          "app/warper-keeper-app.tsx",
          "app/keeper-library.tsx",
          "worker/index.ts",
        ],
        readmeExcerpt: "Portable context and proof for people and agents.",
        clonedAt: "2026-07-28T12:08:00.000Z",
      },
      createdAt: "2026-07-28T12:08:00.000Z",
    },
    {
      id: "source-launch-checklist",
      keeperId: "keeper-sample",
      kind: "link",
      title: "Farcaster launch checklist",
      summary:
        "Manifest, embed image, ready signal, domain identity, and share flow.",
      url: "https://miniapps.farcaster.xyz/docs/guides/publishing",
      createdAt: "2026-07-28T12:12:00.000Z",
    },
  ],
  relations: [
    {
      id: "relation-brief-checklist",
      keeperId: "keeper-sample",
      fromSourceId: "source-product-brief",
      toSourceId: "source-launch-checklist",
      label: "requires",
      createdAt: "2026-07-28T12:15:00.000Z",
    },
    {
      id: "relation-repo-checklist",
      keeperId: "keeper-sample",
      fromSourceId: "source-public-repo",
      toSourceId: "source-launch-checklist",
      label: "implements",
      createdAt: "2026-07-28T12:16:00.000Z",
    },
  ],
  proofDrops: [
    {
      id: "proof-drop-launch",
      keeperId: "keeper-sample",
      title: "Launch context pack",
      purpose:
        "Give a launch reviewer the exact product, repository, and Farcaster context.",
      sourceIds: [
        "source-product-brief",
        "source-public-repo",
        "source-launch-checklist",
      ],
      hash:
        "sha256:8bd50b3fb34dbca7bfe14fb814c2af14e96ea4380a8e9bea1c2bc3b8939abf10",
      envelope: {
        contractVersion: "warper-keeper-proof-drop/1",
        title: "Launch context pack",
        sourceCount: 3,
      },
      createdAt: "2026-07-28T12:40:00.000Z",
    },
  ],
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function avatarLetters(profile: Profile) {
  return profile.displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

async function hashReceipt(payload: Record<string, unknown>) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function canonicalGitHubUrl(value: string) {
  const parsed = new URL(value);
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "github.com" ||
    parts.length !== 2 ||
    parsed.search ||
    parsed.hash ||
    parts[1].endsWith(".git")
  ) {
    throw new Error("Use a public github.com/owner/repository URL.");
  }
  return {
    owner: parts[0],
    repository: parts[1],
    url: `https://github.com/${parts[0]}/${parts[1]}`,
  };
}

async function inspectPublicRepository(value: string) {
  const parsed = canonicalGitHubUrl(value);
  const api = `https://api.github.com/repos/${parsed.owner}/${parsed.repository}`;
  const metadataResponse = await fetch(api, {
    headers: { accept: "application/vnd.github+json" },
  });
  if (!metadataResponse.ok) throw new Error("Public repository was not found.");
  const metadata = (await metadataResponse.json()) as {
    private?: boolean;
    default_branch?: string;
    full_name?: string;
  };
  if (metadata.private !== false || !metadata.default_branch) {
    throw new Error("Repository must be public.");
  }
  const commitResponse = await fetch(
    `${api}/commits/${encodeURIComponent(metadata.default_branch)}`,
    { headers: { accept: "application/vnd.github+json" } },
  );
  if (!commitResponse.ok) throw new Error("Repository commit could not be read.");
  const commit = (await commitResponse.json()) as { sha?: string };
  if (!commit.sha || !/^[a-f0-9]{40}$/i.test(commit.sha)) {
    throw new Error("Repository did not return a valid commit.");
  }
  const commitSha = commit.sha.toLowerCase();
  const treeResponse = await fetch(`${api}/git/trees/${commitSha}?recursive=1`, {
    headers: { accept: "application/vnd.github+json" },
  });
  if (!treeResponse.ok) throw new Error("Repository tree could not be indexed.");
  const tree = (await treeResponse.json()) as {
    tree?: Array<{ path?: string; type?: string }>;
    truncated?: boolean;
  };
  const repositoryFiles = (tree.tree ?? [])
    .filter((item) => item.type === "blob" && item.path)
    .map((item) => item.path!)
    .slice(0, 500);
  const readmeResponse = await fetch(`${api}/readme`, {
    headers: { accept: "application/vnd.github.raw+json" },
  });
  const readmeExcerpt = readmeResponse.ok
    ? (await readmeResponse.text()).replace(/\s+/g, " ").trim().slice(0, 2_000)
    : undefined;
  return {
    canonicalUrl: parsed.url,
    commitSha,
    snapshot: {
      owner: parsed.owner,
      repository: parsed.repository,
      defaultBranch: metadata.default_branch,
      commitSha,
      fileCount: (tree.tree ?? []).filter((item) => item.type === "blob").length,
      files: repositoryFiles,
      ...(readmeExcerpt ? { readmeExcerpt } : {}),
      clonedAt: new Date().toISOString(),
    },
  };
}

export function WarperKeeperApp() {
  const sdkRef = useRef<MiniAppSdk | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isMiniApp, setIsMiniApp] = useState(false);
  const [isDurable, setIsDurable] = useState(false);
  const [gatewayOnline, setGatewayOnline] = useState<boolean | null>(null);
  const [profile, setProfile] = useState<Profile>({
    displayName: "Browser preview",
  });
  const [state, setState] = useState<KeeperState>(emptyKeeperState);
  const [view, setView] = useState<ViewName>("workspace");
  const [onboarding, setOnboarding] = useState<0 | 1 | 2>(0);
  const [selectedTemplate, setSelectedTemplate] =
    useState<KeeperTemplate>("project");
  const [keeperName, setKeeperName] = useState("My Keeper");
  const [showNewTrapper, setShowNewTrapper] = useState(false);
  const [showPersonalize, setShowPersonalize] = useState(false);
  const [activeTrapperId, setActiveTrapperId] = useState<string | null>(null);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskObjective, setTaskObjective] = useState("");
  const [taskRisk, setTaskRisk] = useState<RiskLevel>("low");
  const [taskSourceIds, setTaskSourceIds] = useState<string[]>([]);
  const [contextDraft, setContextDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [incomingTrapper, setIncomingTrapper] = useState<TrapperBundle | null>(null);

  const apiFetch = useCallback(async (path: string, init?: RequestInit) => {
    const sdk = sdkRef.current;
    if (!sdk) throw new Error("Farcaster session unavailable");
    return sdk.quickAuth.fetch(path, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  }, []);

  const pulse = useCallback(async (kind: "light" | "medium" | "success") => {
    const sdk = sdkRef.current;
    if (!sdk) return;
    try {
      if (kind === "success") await sdk.haptics.notificationOccurred("success");
      else await sdk.haptics.impactOccurred(kind);
    } catch {
      // Haptics are optional across Farcaster clients.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      fetch("/api/gateway-health")
        .then((response) => setGatewayOnline(response.ok))
        .catch(() => setGatewayOnline(false));

      try {
        const incomingUrl = new URL(window.location.href);
        const shareToken = incomingUrl.searchParams.get("share");
        const embeddedTrapper = incomingUrl.searchParams.get("trapper");
        if (shareToken && /^[A-Za-z0-9_-]{20,80}$/.test(shareToken)) {
          const sharedResponse = await fetch(
            `/api/trapper-share/${encodeURIComponent(shareToken)}`,
          );
          if (sharedResponse.ok) {
            const payload = (await sharedResponse.json()) as { bundle?: TrapperBundle };
            if (payload.bundle?.contractVersion === "warper-keeper-trapper/1") {
              setIncomingTrapper(payload.bundle);
            }
          }
        } else if (embeddedTrapper) {
          const base64 = embeddedTrapper.replace(/-/g, "+").replace(/_/g, "/");
          const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
          const bytes = Uint8Array.from(atob(padded), (character) =>
            character.charCodeAt(0),
          );
          const bundle = JSON.parse(new TextDecoder().decode(bytes)) as TrapperBundle;
          if (bundle.contractVersion === "warper-keeper-trapper/1") {
            setIncomingTrapper(bundle);
          }
        }

        const { sdk } = await import("@farcaster/miniapp-sdk");
        sdkRef.current = sdk;
        const insideMiniApp = await sdk.isInMiniApp();
        if (cancelled) return;
        setIsMiniApp(insideMiniApp);

        if (insideMiniApp) {
          const context = await sdk.context;
          setProfile({
            fid: context.user.fid,
            username: context.user.username,
            displayName:
              context.user.displayName ??
              context.user.username ??
              `Farcaster #${context.user.fid}`,
            pfpUrl: context.user.pfpUrl,
          });
          const response = await sdk.quickAuth.fetch("/api/miniapp/state");
          if (response.ok) {
            setState(normalizeKeeperState(await response.json()));
            setIsDurable(true);
          } else {
            setNotice("Cloud save is temporarily unavailable. Your preview still works.");
          }
          await sdk.actions.ready();
        } else {
          const saved = window.localStorage.getItem(previewStorageKey);
          if (saved) setState(normalizeKeeperState(JSON.parse(saved)));
        }
      } catch {
        const saved = window.localStorage.getItem(previewStorageKey);
        if (saved) setState(normalizeKeeperState(JSON.parse(saved)));
      } finally {
        if (!cancelled) setIsReady(true);
      }
    }

    void initialize();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (isReady && !isDurable) {
      window.localStorage.setItem(previewStorageKey, JSON.stringify(state));
    }
  }, [isDurable, isReady, state]);

  const activeTrapper = useMemo(
    () => state.trappers.find((item) => item.id === activeTrapperId) ?? null,
    [activeTrapperId, state.trappers],
  );

  const openTrappers = state.trappers.filter((item) => item.status === "open");
  const closedTrappers = state.trappers.filter((item) => item.status === "closed");

  async function createKeeper() {
    setBusy(true);
    try {
      let keeper: Keeper;
      if (isMiniApp && isDurable) {
        const response = await apiFetch("/api/miniapp/keepers", {
          method: "POST",
          body: JSON.stringify({ name: keeperName.trim(), template: selectedTemplate }),
        });
        if (!response.ok) throw new Error("Could not create keeper");
        keeper = (await response.json()).keeper as Keeper;
      } else {
        keeper = {
          id: crypto.randomUUID(),
          name: keeperName.trim(),
          template: selectedTemplate,
          createdAt: new Date().toISOString(),
        };
      }
      setState({
        keeper,
        personalization: defaultPersonalization,
        trappers: [],
        receipts: [],
        sources: [],
        relations: [],
        proofDrops: [],
      });
      setOnboarding(0);
      setView("workspace");
      setNotice(`${keeper.name} is ready.`);
      await pulse("success");
    } catch {
      setNotice("Your Keeper could not be created. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function exploreSample() {
    setState(sampleState);
    setView("workspace");
    setNotice("You are exploring a sample Keeper. Create your own when ready.");
    void pulse("light");
  }

  function prepareTrapper(sourceIds: string[]) {
    setTaskSourceIds(sourceIds);
    setTaskTitle("");
    setTaskObjective("");
    setTaskRisk("low");
    setShowNewTrapper(true);
    void pulse("light");
  }

  async function createTrapper() {
    if (!state.keeper || !taskTitle.trim() || !taskObjective.trim()) return;
    setBusy(true);
    try {
      let trapper: Trapper;
      if (isMiniApp && isDurable) {
        const response = await apiFetch("/api/miniapp/trappers", {
          method: "POST",
          body: JSON.stringify({
            keeperId: state.keeper.id,
            title: taskTitle.trim(),
            objective: taskObjective.trim(),
            riskLevel: taskRisk,
            sourceIds: taskSourceIds,
          }),
        });
        if (!response.ok) throw new Error("Could not create task");
        trapper = (await response.json()).trapper as Trapper;
      } else {
        trapper = {
          id: crypto.randomUUID(),
          keeperId: state.keeper.id,
          title: taskTitle.trim(),
          objective: taskObjective.trim(),
          riskLevel: taskRisk,
          status: "open",
          contextCount: taskSourceIds.length,
          sourceIds: taskSourceIds,
          createdAt: new Date().toISOString(),
        };
      }
      setState((current) => ({
        ...current,
        trappers: [trapper, ...current.trappers],
      }));
      setTaskTitle("");
      setTaskObjective("");
      setTaskRisk("low");
      setTaskSourceIds([]);
      setShowNewTrapper(false);
      setActiveTrapperId(trapper.id);
      setNotice("Trapper opened with its source bundle ready.");
      await pulse("medium");
    } catch {
      setNotice("The task could not be opened. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function addContext() {
    if (!activeTrapper || !contextDraft.trim()) return;
    setBusy(true);
    try {
      if (isMiniApp && isDurable) {
        const response = await apiFetch(
          `/api/miniapp/trappers/${activeTrapper.id}/context`,
          {
            method: "POST",
            body: JSON.stringify({ content: contextDraft.trim() }),
          },
        );
        if (!response.ok) throw new Error("Could not save context");
      }
      setState((current) => ({
        ...current,
        trappers: current.trappers.map((item) =>
          item.id === activeTrapper.id
            ? { ...item, contextCount: item.contextCount + 1 }
            : item,
        ),
      }));
      setContextDraft("");
      setNotice("Context saved.");
      await pulse("light");
    } catch {
      setNotice("That context could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function closeTrapper() {
    if (!activeTrapper) return;
    setBusy(true);
    try {
      let trapper: Trapper;
      let receipt: Receipt;
      if (isMiniApp && isDurable) {
        const response = await apiFetch(
          `/api/miniapp/trappers/${activeTrapper.id}/close`,
          { method: "POST", body: "{}" },
        );
        if (!response.ok) throw new Error("Could not close task");
        const payload = (await response.json()) as {
          trapper: Trapper;
          receipt: Receipt;
        };
        trapper = payload.trapper;
        receipt = payload.receipt;
      } else {
        const closedAt = new Date().toISOString();
        trapper = { ...activeTrapper, status: "closed", closedAt };
        const payload = {
          contractVersion: "warper-keeper-receipt/1",
         trapperId: activeTrapper.id,
         keeperId: activeTrapper.keeperId,
         title: activeTrapper.title,
         objective: activeTrapper.objective,
          contextCount: activeTrapper.contextCount,
          sourceIds: activeTrapper.sourceIds,
          sourceCount: activeTrapper.sourceIds.length,
          completedAt: closedAt,
          result: "Task closed by owner",
        };
        receipt = {
          id: crypto.randomUUID(),
          trapperId: activeTrapper.id,
          hash: await hashReceipt(payload),
          payload,
          createdAt: closedAt,
        };
      }
      setState((current) => ({
        ...current,
        trappers: current.trappers.map((item) =>
          item.id === trapper.id ? trapper : item,
        ),
        receipts: [receipt, ...current.receipts],
      }));
      setActiveTrapperId(null);
      setView("proof");
      setNotice("Task closed. Its receipt is ready.");
      await pulse("success");
    } catch {
      setNotice("The task could not be closed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function addSource(input: AddSourceInput) {
    if (!state.keeper) return;
    setBusy(true);
    try {
      let source: SourceItem;
      if (isMiniApp && isDurable) {
        const response = await apiFetch("/api/miniapp/sources", {
          method: "POST",
          body: JSON.stringify({ keeperId: state.keeper.id, ...input }),
        });
        if (!response.ok) {
          const payload = (await response.json()) as { error?: string };
          throw new Error(payload.error ?? "Source could not be added.");
        }
        source = ((await response.json()) as { source: SourceItem }).source;
      } else {
        const repository =
          input.kind === "repository" && input.url
            ? await inspectPublicRepository(input.url)
            : null;
        source = {
          id: crypto.randomUUID(),
          keeperId: state.keeper.id,
          kind: input.kind,
          title: input.title.trim(),
          summary: input.summary.trim(),
          ...(input.url
            ? { url: repository?.canonicalUrl ?? new URL(input.url).toString() }
            : {}),
          ...(repository ? { commitSha: repository.commitSha } : {}),
          ...(repository ? { snapshot: repository.snapshot } : {}),
          ...(input.fileName ? { fileName: input.fileName } : {}),
          ...(input.mimeType ? { mimeType: input.mimeType } : {}),
          ...(input.contentExcerpt ? { contentExcerpt: input.contentExcerpt } : {}),
          createdAt: new Date().toISOString(),
        };
      }
      setState((current) => ({
        ...current,
        sources: [source, ...current.sources],
      }));
      setNotice(
        source.kind === "repository"
          ? "Repository snapshot cloned, pinned, and indexed."
          : "Source caught and ready to trap.",
      );
      await pulse("success");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Source could not be added.",
      );
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function savePersonalization(value: KeeperPersonalization) {
    if (!state.keeper) return;
    setBusy(true);
    try {
      let personalization = value;
      if (isMiniApp && isDurable) {
        const response = await apiFetch("/api/miniapp/personalization", {
          method: "POST",
          body: JSON.stringify({
            keeperId: state.keeper.id,
            ...value,
          }),
        });
        if (!response.ok) throw new Error("Personalization could not be saved.");
        personalization = (
          (await response.json()) as {
            personalization: KeeperPersonalization;
          }
        ).personalization;
      }
      setState((current) => ({ ...current, personalization }));
      setShowPersonalize(false);
      setNotice("Keeper personalization saved.");
      await pulse("success");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Personalization could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function addRelation(fromSourceId: string, toSourceId: string, label: string) {
    if (!state.keeper) return;
    setBusy(true);
    try {
      let relation: SourceRelation;
      if (isMiniApp && isDurable) {
        const response = await apiFetch("/api/miniapp/relations", {
          method: "POST",
          body: JSON.stringify({
            keeperId: state.keeper.id,
            fromSourceId,
            toSourceId,
            label: label.trim(),
          }),
        });
        if (!response.ok) throw new Error("Connection could not be saved.");
        relation = ((await response.json()) as { relation: SourceRelation }).relation;
      } else {
        relation = {
          id: crypto.randomUUID(),
          keeperId: state.keeper.id,
          fromSourceId,
          toSourceId,
          label: label.trim(),
          createdAt: new Date().toISOString(),
        };
      }
      setState((current) => ({
        ...current,
        relations: [relation, ...current.relations],
      }));
      setNotice("Sources connected.");
      await pulse("light");
    } finally {
      setBusy(false);
    }
  }

  async function buildProofDrop(
    title: string,
    purpose: string,
    sourceIds: string[],
  ) {
    if (!state.keeper) return;
    setBusy(true);
    try {
      let proofDrop: ProofDrop;
      if (isMiniApp && isDurable) {
        const response = await apiFetch("/api/miniapp/proof-drops", {
          method: "POST",
          body: JSON.stringify({
            keeperId: state.keeper.id,
            title: title.trim(),
            purpose: purpose.trim(),
            sourceIds,
          }),
        });
        if (!response.ok) throw new Error("Context pack could not be built.");
        proofDrop = ((await response.json()) as { proofDrop: ProofDrop }).proofDrop;
      } else {
        const sources = state.sources
          .filter((source) => sourceIds.includes(source.id))
          .map(({ id, kind, title: sourceTitle, url, commitSha }) => ({
            id,
            kind,
            title: sourceTitle,
            ...(url ? { url } : {}),
            ...(commitSha ? { commitSha } : {}),
          }));
        const createdAt = new Date().toISOString();
        const envelope = {
          contractVersion: "warper-keeper-proof-drop/1",
          keeperId: state.keeper.id,
          title: title.trim(),
          purpose: purpose.trim(),
          sources,
          createdAt,
        };
        proofDrop = {
          id: crypto.randomUUID(),
          keeperId: state.keeper.id,
          title: title.trim(),
          purpose: purpose.trim(),
          sourceIds,
          hash: await sha256Canonical(envelope),
          envelope,
          createdAt,
        };
      }
      setState((current) => ({
        ...current,
        proofDrops: [proofDrop, ...current.proofDrops],
      }));
      setNotice("Proofed context pack created.");
      await pulse("success");
    } finally {
      setBusy(false);
    }
  }

  async function attachSourceToTask(source: SourceItem, task: Trapper) {
    if (task.sourceIds.includes(source.id)) {
      setNotice(`${source.title} is already inside ${task.title}.`);
      return;
    }
    setBusy(true);
    try {
      if (isMiniApp && isDurable) {
        const response = await apiFetch(
          `/api/miniapp/trappers/${task.id}/sources`,
          {
            method: "POST",
            body: JSON.stringify({ sourceId: source.id }),
          },
        );
        if (!response.ok) throw new Error("Source could not be attached.");
      }
      setState((current) => ({
        ...current,
        trappers: current.trappers.map((item) =>
          item.id === task.id
            ? {
                ...item,
                contextCount: item.contextCount + 1,
                sourceIds: [...item.sourceIds, source.id],
              }
            : item,
        ),
      }));
      setNotice(`${source.title} attached to ${task.title}.`);
      await pulse("light");
    } finally {
      setBusy(false);
    }
  }

  async function importKeeper(value: unknown) {
    const imported = normalizeKeeperState(value);
    if (!imported.keeper) {
      setNotice("That file does not contain a Keeper.");
      return;
    }
    setBusy(true);
    try {
      if (isMiniApp && isDurable) {
        const response = await apiFetch("/api/miniapp/import", {
          method: "POST",
          body: JSON.stringify(imported),
        });
        if (!response.ok) throw new Error("Keeper import could not be saved.");
        setState(normalizeKeeperState(await response.json()));
      } else {
        setState(imported);
      }
      setNotice(`${imported.keeper.name} imported.`);
      await pulse("success");
    } catch {
      setNotice("Keeper import could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  function downloadJson(name: string, value: unknown) {
    const blob = new Blob([JSON.stringify(value, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportKeeper() {
    downloadJson(
      `${state.keeper?.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "keeper"}.json`,
      state,
    );
  }

  function downloadReceipt(receipt: Receipt) {
    downloadJson(`${receipt.id}.json`, receipt);
  }

  function downloadProofDrop(proofDrop: ProofDrop) {
    downloadJson(`${proofDrop.id}.json`, proofDrop);
  }

  async function shareKeeper() {
    const text = `${state.keeper?.name ?? "My Keeper"} is keeping agent work bounded and provable with Warper Keeper.`;
    try {
      if (sdkRef.current && isMiniApp) {
        await sdkRef.current.actions.composeCast({
          text,
          embeds: [window.location.href],
        });
      } else if (navigator.share) {
        await navigator.share({ title: "Warper Keeper", text, url: window.location.href });
      } else {
        await navigator.clipboard.writeText(window.location.href);
        setNotice("Link copied.");
      }
    } catch {
      // Closing the native share sheet is not an application error.
    }
  }

  function trapperBundle(trapper: Trapper): TrapperBundle {
    const receipt = state.receipts.find((item) => item.trapperId === trapper.id);
    return {
      contractVersion: "warper-keeper-trapper/1",
      trapper: {
        id: trapper.id,
        title: trapper.title,
        objective: trapper.objective,
        riskLevel: trapper.riskLevel,
        status: trapper.status,
        createdAt: trapper.createdAt,
        ...(trapper.closedAt ? { closedAt: trapper.closedAt } : {}),
      },
      sources: state.sources.filter((source) => trapper.sourceIds.includes(source.id)),
      ...(receipt ? { receipt } : {}),
      exportedAt: new Date().toISOString(),
    };
  }

  async function shareTrapper(trapper: Trapper) {
    setBusy(true);
    try {
      const bundle = trapperBundle(trapper);
      let shareUrl = "";
      if (isMiniApp && isDurable) {
        const response = await apiFetch(
          `/api/miniapp/trappers/${encodeURIComponent(trapper.id)}/share`,
          { method: "POST", body: "{}" },
        );
        if (!response.ok) throw new Error("Share link could not be created.");
        shareUrl = ((await response.json()) as { url: string }).url;
      } else {
        const encoded = btoa(
          encodeURIComponent(JSON.stringify(bundle)).replace(
            /%([0-9A-F]{2})/g,
            (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)),
          ),
        )
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");
        shareUrl = `${window.location.origin}${window.location.pathname}?trapper=${encoded}`;
      }
      if (navigator.share) {
        await navigator.share({
          title: trapper.title,
          text: `${trapper.title} · ${trapper.sourceIds.length} portable sources`,
          url: shareUrl,
        });
      } else {
        await navigator.clipboard.writeText(shareUrl);
        setNotice("Trapper link copied. Anyone with the link can inspect the bundle.");
      }
      await pulse("success");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setNotice(
        error instanceof Error ? error.message : "The Trapper could not be shared.",
      );
    } finally {
      setBusy(false);
    }
  }

  function downloadTrapper(trapper: Trapper) {
    downloadJson(
      `${trapper.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "trapper"}.json`,
      trapperBundle(trapper),
    );
  }

  if (!isReady) {
    return (
      <main className="loading-screen" aria-busy="true">
        <Image src="/warper-icon.png" alt="" width={72} height={72} priority unoptimized />
        <strong>Opening Warper Keeper</strong>
      </main>
    );
  }

  if (incomingTrapper) {
    return (
      <SharedTrapperPage
        bundle={incomingTrapper}
        onDownload={() =>
          downloadJson(
            `${incomingTrapper.trapper.title
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")}.json`,
            incomingTrapper,
          )
        }
        onOpenKeeper={() => {
          const cleanUrl = new URL(window.location.href);
          cleanUrl.search = "";
          window.history.replaceState({}, "", cleanUrl);
          setIncomingTrapper(null);
        }}
      />
    );
  }

  if (!state.keeper && onboarding === 0) {
    return (
      <main className="welcome-shell">
        <div className="welcome-grid" aria-hidden="true" />
        <header className="welcome-header">
          <div className="brand-lockup">
            <Image
              src="/warper-icon.png"
              alt=""
              width={38}
              height={38}
              priority
              unoptimized
            />
            <strong>Warper Keeper</strong>
          </div>
          <GatewayStatus online={gatewayOnline} />
        </header>

        <section className="welcome-content">
          <div className="welcome-copy">
            <p className="eyebrow">Portable knowledge for people + agents</p>
            <h1>Catch the good stuff. Send it ready.</h1>
            <p className="welcome-lede">
              Save notes, links, files, and public repositories. Wrap the exact
              sources in a Trapper so anyone can continue without the
              missing-context tax.
            </p>

            <div className="promise-list">
              <div>
                <Library size={20} />
                <span>Catch sources without losing where they came from</span>
              </div>
              <div>
                <PackageOpen size={20} />
                <span>Bundle only the context you want to send</span>
              </div>
              <div>
                <FileCheck2 size={20} />
                <span>Carry lineage and proof with every Trapper</span>
              </div>
            </div>

            <div className="welcome-actions">
              <button
                className="primary-command"
                onClick={() => {
                  setOnboarding(1);
                  void pulse("medium");
                }}
              >
                Build my Keeper
                <ChevronRight size={18} />
              </button>
              <button className="text-command" onClick={exploreSample}>
                Explore a working Trapper
              </button>
            </div>
          </div>

          <div className="keeper-preview" aria-label="Warper Keeper preview">
            <div className="preview-rail">
              <Image
                src="/warper-icon.png"
                alt=""
                width={30}
                height={30}
                unoptimized
              />
              <span />
              <span />
              <span />
            </div>
            <div className="preview-main">
              <div className="preview-title">
                <span>Idea Remix Desk</span>
                <i>3 sources</i>
              </div>
              <div className="preview-task">
                <small>OPEN TRAPPER</small>
                <strong>Turn old research into a launch</strong>
                <div className="preview-progress">
                  <span />
                </div>
                <p>Public repo · field notes · launch checklist</p>
              </div>
              <div className="preview-proof">
                <ShieldCheck size={22} />
                <div>
                  <small>PORTABLE PROOF</small>
                  <strong>Sources pinned and ready to share</strong>
                </div>
                <Check size={18} />
              </div>
            </div>
          </div>
        </section>

        {!isMiniApp && (
          <div className="preview-notice">
            <Radio size={16} />
            Browser preview saves on this device. Open in Farcaster for your
            durable personal Keeper.
          </div>
        )}
      </main>
    );
  }

  if (!state.keeper && onboarding > 0) {
    return (
      <main className="onboarding-shell">
        <header className="onboarding-header">
          <button
            className="icon-command"
            aria-label="Go back"
            onClick={() => setOnboarding(onboarding === 2 ? 1 : 0)}
          >
            <ArrowLeft size={20} />
          </button>
          <span>Set up your Keeper</span>
          <span className="step-count">{onboarding} / 2</span>
        </header>

        {onboarding === 1 ? (
          <section className="onboarding-stage">
            <p className="eyebrow">Choose a starting point</p>
            <h1>What are you collecting?</h1>
            <div className="template-list">
              {templateOptions.map((template) => (
                <button
                  key={template.id}
                  className={selectedTemplate === template.id ? "selected" : ""}
                  onClick={() => setSelectedTemplate(template.id)}
                >
                  <span>
                    <strong>{template.name}</strong>
                    <small>{template.detail}</small>
                  </span>
                  {selectedTemplate === template.id ? (
                    <Check size={19} />
                  ) : (
                    <ChevronRight size={19} />
                  )}
                </button>
              ))}
            </div>
            <button className="primary-command full" onClick={() => setOnboarding(2)}>
              Continue
              <ChevronRight size={18} />
            </button>
          </section>
        ) : (
          <section className="onboarding-stage">
            <p className="eyebrow">Name your workspace</p>
            <h1>Make it easy to recognize.</h1>
            <label className="field-label" htmlFor="keeper-name">
              Keeper name
            </label>
            <input
              id="keeper-name"
              className="text-field"
              value={keeperName}
              maxLength={42}
              onChange={(event) => setKeeperName(event.target.value)}
              autoFocus
            />
            <div className="boundary-box">
              <ShieldCheck size={22} />
              <div>
                <strong>Protected by default</strong>
                <p>
                  Agents can add context, submit work, and request approval.
                  Publishing, payments, and deployments stay blocked.
                </p>
              </div>
            </div>
            <button
              className="primary-command full"
              disabled={!keeperName.trim() || busy}
              onClick={() => void createKeeper()}
            >
              {busy ? "Creating..." : "Create my Keeper"}
              <Sparkles size={18} />
            </button>
          </section>
        )}
      </main>
    );
  }

  return (
    <main className={`app-shell theme-${state.personalization.theme}`}>
      <aside className="side-rail">
        <div className="brand-lockup compact">
          <Image
            src="/warper-icon.png"
            alt=""
            width={34}
            height={34}
            unoptimized
          />
          <strong>Warper Keeper</strong>
        </div>
        <nav aria-label="Keeper sections">
          <NavButton
            active={view === "workspace"}
            icon={<Layers3 size={19} />}
            label="Workspace"
            onClick={() => setView("workspace")}
          />
          <NavButton
            active={view === "trappers"}
            icon={<FolderKanban size={19} />}
            label="Trappers"
            onClick={() => setView("trappers")}
          />
          <NavButton
            active={view === "library"}
            icon={<BookOpen size={19} />}
            label="Source lab"
            onClick={() => setView("library")}
          />
          <NavButton
            active={view === "proof"}
            icon={<ReceiptText size={19} />}
            label="Proof"
            onClick={() => setView("proof")}
          />
        </nav>
        <div className="rail-footer">
          <GatewayStatus online={gatewayOnline} />
          <span>{isDurable ? "Cloud saved" : "Device preview"}</span>
        </div>
      </aside>

      <section className="workspace">
         <header className="workspace-header">
           <div>
             <p className="workspace-kicker">YOUR KEEPER</p>
             <h1>{state.keeper?.name}</h1>
             <p className="keeper-tagline">{state.personalization.tagline}</p>
             {state.personalization.stickers.length > 0 && (
               <div className="keeper-stickers" aria-label="Keeper stickers">
                 {state.personalization.stickers.map((sticker, index) => (
                   <span key={`${sticker}-${index}`}>{sticker}</span>
                 ))}
               </div>
             )}
           </div>
           <div className="header-actions">
             <button
               className="icon-command"
               aria-label="Personalize Keeper"
               title="Personalize Keeper"
               onClick={() => setShowPersonalize(true)}
             >
               <Palette size={18} />
             </button>
             <button
              className="icon-command"
              aria-label="Share Keeper"
              title="Share Keeper"
              onClick={() => void shareKeeper()}
            >
              <Send size={18} />
            </button>
            <div className="profile-chip">
              {profile.pfpUrl ? (
                <Image
                  src={profile.pfpUrl}
                  alt=""
                  width={34}
                  height={34}
                  unoptimized
                />
              ) : (
                <span>{avatarLetters(profile)}</span>
              )}
              <div>
                <strong>{profile.displayName}</strong>
                <small>{profile.username ? `@${profile.username}` : "Owner"}</small>
              </div>
            </div>
          </div>
        </header>

        {notice && (
          <div className="notice-bar" role="status">
            <span>{notice}</span>
            <button
              className="icon-command small"
              aria-label="Dismiss message"
              onClick={() => setNotice("")}
            >
              <X size={16} />
            </button>
          </div>
        )}

        {view === "workspace" && (
          <KeeperWorkspace
            state={state}
            busy={busy}
            onAddSource={addSource}
            onPrepareTrapper={prepareTrapper}
            onOpenTrapper={setActiveTrapperId}
            onShareTrapper={shareTrapper}
            onOpenSourceLab={() => setView("library")}
          />
        )}

        {view === "trappers" && (
          <TrappersView
            openTrappers={openTrappers}
            closedTrappers={closedTrappers}
            onNew={() => prepareTrapper([])}
            onOpen={setActiveTrapperId}
            onShare={shareTrapper}
          />
        )}

        {view === "library" && (
          <KeeperLibrary
            state={state}
            busy={busy}
            onAddSource={addSource}
            onAddRelation={addRelation}
            onBuildProofDrop={buildProofDrop}
            onAttachToTask={attachSourceToTask}
            onExport={exportKeeper}
            onImport={importKeeper}
          />
        )}

        {view === "proof" && (
          <ProofView
            receipts={state.receipts}
            proofDrops={state.proofDrops}
            onDownload={downloadReceipt}
            onDownloadProofDrop={downloadProofDrop}
          />
        )}
      </section>

      <nav className="mobile-nav" aria-label="Keeper sections">
        <NavButton
          active={view === "workspace"}
          icon={<Layers3 size={20} />}
          label="Workspace"
          onClick={() => setView("workspace")}
        />
        <NavButton
          active={view === "trappers"}
          icon={<FolderKanban size={20} />}
          label="Trappers"
          onClick={() => setView("trappers")}
        />
        <NavButton
          active={view === "library"}
          icon={<BookOpen size={20} />}
          label="Sources"
          onClick={() => setView("library")}
        />
        <NavButton
          active={view === "proof"}
          icon={<ReceiptText size={20} />}
          label="Proof"
          onClick={() => setView("proof")}
        />
      </nav>

      {showNewTrapper && (
        <div className="sheet-backdrop" role="presentation">
          <section className="task-sheet" role="dialog" aria-modal="true">
            <div className="sheet-header">
              <div>
                <p className="eyebrow">Portable source bundle</p>
                <h2>Build a Trapper</h2>
              </div>
              <button
                className="icon-command"
                aria-label="Close"
                onClick={() => setShowNewTrapper(false)}
              >
                <X size={20} />
              </button>
            </div>
            <label className="field-label" htmlFor="task-title">
              Trapper name
            </label>
            <input
              id="task-title"
              className="text-field"
              value={taskTitle}
              onChange={(event) => setTaskTitle(event.target.value)}
              placeholder="Launch handoff"
            />
            <label className="field-label" htmlFor="task-objective">
              What should happen next?
            </label>
            <textarea
              id="task-objective"
              className="text-area"
              value={taskObjective}
              onChange={(event) => setTaskObjective(event.target.value)}
              placeholder="Give the recipient a clear objective for using these sources."
            />
            {state.sources.length > 0 && (
              <fieldset className="trapper-source-picker">
                <legend>Sources inside this Trapper</legend>
                <div>
                  {state.sources.map((source) => (
                    <label key={source.id}>
                      <input
                        type="checkbox"
                        checked={taskSourceIds.includes(source.id)}
                        onChange={(event) =>
                          setTaskSourceIds((current) =>
                            event.target.checked
                              ? [...current, source.id]
                              : current.filter((item) => item !== source.id),
                          )
                        }
                      />
                      <span>{source.title}</span>
                      <small>{source.kind}</small>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <fieldset className="risk-control">
              <legend>Risk level</legend>
              {(["low", "medium", "high"] as RiskLevel[]).map((risk) => (
                <button
                  type="button"
                  key={risk}
                  className={taskRisk === risk ? "selected" : ""}
                  onClick={() => setTaskRisk(risk)}
                >
                  {risk}
                </button>
              ))}
            </fieldset>
            <button
              className="primary-command full"
              disabled={!taskTitle.trim() || !taskObjective.trim() || busy}
              onClick={() => void createTrapper()}
            >
              {busy
                ? "Building..."
                : `Build Trapper${
                    taskSourceIds.length ? ` with ${taskSourceIds.length} sources` : ""
                  }`}
              <Plus size={18} />
            </button>
          </section>
        </div>
      )}

      {showPersonalize && state.keeper && (
        <KeeperPersonalize
          keeperName={state.keeper.name}
          value={state.personalization}
          busy={busy}
          onSave={savePersonalization}
          onClose={() => setShowPersonalize(false)}
        />
      )}

      {activeTrapper && (
        <div className="sheet-backdrop" role="presentation">
          <section className="task-sheet detail" role="dialog" aria-modal="true">
            <div className="sheet-header">
              <div>
                <span className={`risk-pill ${activeTrapper.riskLevel}`}>
                  {activeTrapper.riskLevel} risk
                </span>
                <h2>{activeTrapper.title}</h2>
              </div>
              <button
                className="icon-command"
                aria-label="Close"
                onClick={() => setActiveTrapperId(null)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="objective-block">
              <small>DONE LOOKS LIKE</small>
              <p>{activeTrapper.objective}</p>
            </div>
            <div className="context-count">
              <Library size={18} />
                <span>
                  {activeTrapper.sourceIds.length} sources · {activeTrapper.contextCount} context
                  items
                </span>
            </div>
            {activeTrapper.sourceIds.length > 0 && (
              <div className="active-trapper-sources">
                {activeTrapper.sourceIds.map((sourceId) => {
                  const source = state.sources.find((item) => item.id === sourceId);
                  return source ? <span key={source.id}>{source.title}</span> : null;
                })}
              </div>
            )}
            {activeTrapper.status === "open" && (
              <>
                <label className="field-label" htmlFor="context-note">
                  Add context
                </label>
                <textarea
                  id="context-note"
                  className="text-area"
                  value={contextDraft}
                  onChange={(event) => setContextDraft(event.target.value)}
                  placeholder="Paste a note, source link, decision, or instruction..."
                />
                <button
                  className="secondary-command full"
                  disabled={!contextDraft.trim() || busy}
                  onClick={() => void addContext()}
                >
                  Add note to Trapper
                  <Plus size={17} />
                </button>
              </>
            )}
            <div className="trapper-share-row">
              <button
                className="secondary-command"
                disabled={busy}
                onClick={() => void shareTrapper(activeTrapper)}
              >
                <Send size={17} />
                Share Trapper
              </button>
              <button
                className="icon-command"
                aria-label="Download Trapper"
                title="Download Trapper JSON"
                onClick={() => downloadTrapper(activeTrapper)}
              >
                <Download size={17} />
              </button>
            </div>
            {activeTrapper.status === "open" ? (
              <>
                <div className="sheet-divider" />
                <button
                  className="primary-command full"
                  disabled={busy}
                  onClick={() => void closeTrapper()}
                >
                  {busy ? "Closing..." : "Seal Trapper and issue receipt"}
                  <FileCheck2 size={18} />
                </button>
              </>
            ) : (
              <div className="sealed-trapper-note">
                <ShieldCheck size={19} />
                This Trapper is sealed. Its receipt travels with the bundle.
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function SharedTrapperPage({
  bundle,
  onDownload,
  onOpenKeeper,
}: {
  bundle: TrapperBundle;
  onDownload: () => void;
  onOpenKeeper: () => void;
}) {
  return (
    <main className="shared-trapper-shell">
      <header className="shared-trapper-header">
        <div className="brand-lockup compact">
          <Image
            src="/warper-icon.png"
            alt=""
            width={36}
            height={36}
            unoptimized
          />
          <strong>Warper Keeper</strong>
        </div>
        <button className="secondary-command" onClick={onOpenKeeper}>
          <ArrowLeft size={17} />
          Open my Keeper
        </button>
      </header>
      <section className="shared-trapper-card">
        <div className="shared-trapper-seal">
          <PackageOpen size={30} />
          <span>PORTABLE TRAPPER</span>
        </div>
        <p className="eyebrow">Shared working context</p>
        <h1>{bundle.trapper.title}</h1>
        <p className="shared-objective">{bundle.trapper.objective}</p>
        <div className="shared-stats">
          <span>{bundle.sources.length} sources</span>
          <span>{bundle.trapper.riskLevel} risk</span>
          <span>{bundle.receipt ? "receipt attached" : "still in motion"}</span>
        </div>
        <div className="shared-source-grid">
          {bundle.sources.map((source, index) => (
            <article key={source.id}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <BookOpen size={19} />
              <div>
                <strong>{source.title}</strong>
                <small>
                  {source.kind === "repository" ? "GitHub snapshot" : source.kind}
                </small>
                <p>{source.summary}</p>
                {source.snapshot && (
                  <code>
                    {source.snapshot.fileCount} files ·{" "}
                    {source.snapshot.commitSha.slice(0, 7)}
                  </code>
                )}
              </div>
            </article>
          ))}
        </div>
        {bundle.receipt && (
          <div className="shared-proof">
            <ShieldCheck size={21} />
            <div>
              <strong>Receipt attached</strong>
              <code>{bundle.receipt.hash}</code>
            </div>
          </div>
        )}
        <button className="primary-command full" onClick={onDownload}>
          <Download size={18} />
          Download complete Trapper
        </button>
      </section>
      <p className="shared-trapper-footnote">
        This read-only bundle contains the exact sources and lineage its sender chose to
        share.
      </p>
    </main>
  );
}

function GatewayStatus({ online }: { online: boolean | null }) {
  return (
    <div className={`gateway-status ${online === false ? "offline" : ""}`}>
      <span />
      {online === null ? "Checking gateway" : online ? "Gateway online" : "Gateway delayed"}
    </div>
  );
}

function NavButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={active ? "active" : ""} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function TrappersView({
  openTrappers,
  closedTrappers,
  onNew,
  onOpen,
  onShare,
}: {
  openTrappers: Trapper[];
  closedTrappers: Trapper[];
  onNew: () => void;
  onOpen: (id: string) => void;
  onShare: (trapper: Trapper) => Promise<void>;
}) {
  return (
    <div className="view-content">
      <div className="view-title">
        <div>
          <p className="eyebrow">Portable working context</p>
          <h2>Trappers</h2>
        </div>
        <button className="primary-command" onClick={onNew}>
          <Plus size={18} />
          Build Trapper
        </button>
      </div>
      <section className="section-block">
        <div className="section-heading">
          <h3>Open</h3>
          <span>{openTrappers.length}</span>
        </div>
        {openTrappers.length ? (
          <div className="task-list">
            {openTrappers.map((trapper) => (
              <TaskRow
                key={trapper.id}
                trapper={trapper}
                onOpen={onOpen}
                onShare={onShare}
              />
            ))}
          </div>
        ) : (
          <EmptyTask onNew={onNew} />
        )}
      </section>
      {closedTrappers.length > 0 && (
        <section className="section-block">
          <div className="section-heading">
            <h3>Closed</h3>
            <span>{closedTrappers.length}</span>
          </div>
          <div className="task-list">
            {closedTrappers.map((trapper) => (
              <TaskRow
                key={trapper.id}
                trapper={trapper}
                onOpen={onOpen}
                onShare={onShare}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ProofView({
  receipts,
  proofDrops,
  onDownload,
  onDownloadProofDrop,
}: {
  receipts: Receipt[];
  proofDrops: ProofDrop[];
  onDownload: (receipt: Receipt) => void;
  onDownloadProofDrop: (proofDrop: ProofDrop) => void;
}) {
  return (
    <div className="view-content">
      <div className="view-title">
        <div>
          <p className="eyebrow">Verifiable history</p>
          <h2>Proof</h2>
        </div>
      </div>
      <ProofDropList drops={proofDrops} onDownload={onDownloadProofDrop} />
      {receipts.length ? (
        <div className="receipt-list">
          {receipts.map((receipt) => (
            <article className="receipt-card" key={receipt.id}>
              <div className="receipt-mark">
                <ShieldCheck size={22} />
              </div>
               <div className="receipt-copy">
                 <div>
                   <strong>
                     {String(
                       receipt.payload.title ??
                         receipt.payload.result ??
                         "Task completed",
                     )}
                   </strong>
                   <span>{formatTime(receipt.createdAt)}</span>
                 </div>
                 <code>{receipt.hash}</code>
                 <small>
                   {String(
                     receipt.payload.title
                       ? receipt.payload.result ?? "Task completed"
                       : `Receipt ${receipt.id.slice(0, 8)}`,
                   )}
                 </small>
               </div>
              <button
                className="icon-command"
                aria-label="Download receipt"
                title="Download receipt"
                onClick={() => onDownload(receipt)}
              >
                <Download size={18} />
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="plain-empty">
          <ReceiptText size={30} />
          <h3>No receipts yet.</h3>
          <p>Close a completed task and its proof will appear here.</p>
        </div>
      )}
    </div>
  );
}

function TaskRow({
  trapper,
  onOpen,
  onShare,
}: {
  trapper: Trapper;
  onOpen: (id: string) => void;
  onShare?: (trapper: Trapper) => Promise<void>;
}) {
  return (
    <div className="task-row">
      <button className="task-row-open" onClick={() => onOpen(trapper.id)}>
        <span className={`task-state ${trapper.status}`}>
          {trapper.status === "closed" ? <Check size={16} /> : <CircleDot size={16} />}
        </span>
        <span className="task-copy">
          <strong>{trapper.title}</strong>
          <small>
            {trapper.sourceIds.length} sources · {trapper.contextCount} context items ·{" "}
            {trapper.riskLevel} risk
          </small>
        </span>
        <span className="task-time">{formatTime(trapper.createdAt)}</span>
        <ChevronRight size={18} />
      </button>
      {onShare && (
        <button
          className="icon-command"
          aria-label={`Share ${trapper.title}`}
          title="Share Trapper"
          onClick={() => void onShare(trapper)}
        >
          <Send size={17} />
        </button>
      )}
    </div>
  );
}

function EmptyTask({ onNew }: { onNew: () => void }) {
  return (
    <div className="plain-empty compact">
      <FolderKanban size={28} />
      <h3>No open Trappers.</h3>
      <button className="text-command" onClick={onNew}>
        Build the first one
      </button>
    </div>
  );
}
