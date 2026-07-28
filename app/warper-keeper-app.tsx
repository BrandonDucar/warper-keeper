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
  LayoutDashboard,
  Library,
  LockKeyhole,
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
} from "./keeper-types";
import { sha256Canonical } from "./proof-envelope";

type ViewName = "today" | "trappers" | "library" | "proof";

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
  return { canonicalUrl: parsed.url, commitSha: commit.sha.toLowerCase() };
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
  const [view, setView] = useState<ViewName>("today");
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
  const [contextDraft, setContextDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

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
        const { sdk } = await import("@farcaster/miniapp-sdk");
        sdkRef.current = sdk;
        const insideMiniApp = await sdk.isInMiniApp({ timeoutMs: 500 });
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
      setView("today");
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
    setView("today");
    setNotice("You are exploring a sample Keeper. Create your own when ready.");
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
          contextCount: 0,
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
      setShowNewTrapper(false);
      setActiveTrapperId(trapper.id);
      setNotice("Task opened. Add the context your agent needs.");
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
          createdAt: new Date().toISOString(),
        };
      }
      setState((current) => ({
        ...current,
        sources: [source, ...current.sources],
      }));
      setNotice(
        source.kind === "repository"
          ? "Public repository pinned to its current commit."
          : "Source added to your library.",
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
    setBusy(true);
    try {
      if (isMiniApp && isDurable) {
        const response = await apiFetch(
          `/api/miniapp/trappers/${task.id}/context`,
          {
            method: "POST",
            body: JSON.stringify({
              content: `Library source: ${source.title} [${source.id}]`,
            }),
          },
        );
        if (!response.ok) throw new Error("Source could not be attached.");
      }
      setState((current) => ({
        ...current,
        trappers: current.trappers.map((item) =>
          item.id === task.id
            ? { ...item, contextCount: item.contextCount + 1 }
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

  if (!isReady) {
    return (
      <main className="loading-screen" aria-busy="true">
        <Image src="/warper-icon.png" alt="" width={72} height={72} priority unoptimized />
        <strong>Opening Warper Keeper</strong>
      </main>
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
            <p className="eyebrow">Your agent workspace</p>
            <h1>One place for every agent job.</h1>
            <p className="welcome-lede">
              Keep the objective, source material, permissions, artifacts, and
              proof together from start to finish.
            </p>

            <div className="promise-list">
              <div>
                <LockKeyhole size={20} />
                <span>Bound the job before work begins</span>
              </div>
              <div>
                <Library size={20} />
                <span>Keep context attached to the work</span>
              </div>
              <div>
                <FileCheck2 size={20} />
                <span>Close every job with a receipt</span>
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
                Create my Keeper
                <ChevronRight size={18} />
              </button>
              <button className="text-command" onClick={exploreSample}>
                Explore a finished Keeper
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
                <span>Launch Desk</span>
                <i>Active</i>
              </div>
              <div className="preview-task">
                <small>ACTIVE TASK</small>
                <strong>Prepare launch package</strong>
                <div className="preview-progress">
                  <span />
                </div>
                <p>4 context items · approval required</p>
              </div>
              <div className="preview-proof">
                <ShieldCheck size={22} />
                <div>
                  <small>LATEST RECEIPT</small>
                  <strong>Production build verified</strong>
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
            <h1>What will this Keeper organize?</h1>
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
            active={view === "today"}
            icon={<LayoutDashboard size={19} />}
            label="Today"
            onClick={() => setView("today")}
          />
          <NavButton
            active={view === "trappers"}
            icon={<FolderKanban size={19} />}
            label="Tasks"
            onClick={() => setView("trappers")}
          />
          <NavButton
            active={view === "library"}
            icon={<BookOpen size={19} />}
            label="Library"
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

        {view === "today" && (
          <TodayView
            openTrappers={openTrappers}
            receipts={state.receipts}
            onNew={() => setShowNewTrapper(true)}
            onOpen={setActiveTrapperId}
            onProof={() => setView("proof")}
          />
        )}

        {view === "trappers" && (
          <TrappersView
            openTrappers={openTrappers}
            closedTrappers={closedTrappers}
            onNew={() => setShowNewTrapper(true)}
            onOpen={setActiveTrapperId}
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
          active={view === "today"}
          icon={<LayoutDashboard size={20} />}
          label="Today"
          onClick={() => setView("today")}
        />
        <NavButton
          active={view === "trappers"}
          icon={<FolderKanban size={20} />}
          label="Tasks"
          onClick={() => setView("trappers")}
        />
        <NavButton
          active={view === "library"}
          icon={<BookOpen size={20} />}
          label="Library"
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
                <p className="eyebrow">New bounded task</p>
                <h2>Open a task</h2>
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
              Task name
            </label>
            <input
              id="task-title"
              className="text-field"
              value={taskTitle}
              onChange={(event) => setTaskTitle(event.target.value)}
              placeholder="Prepare the launch package"
            />
            <label className="field-label" htmlFor="task-objective">
              Done looks like
            </label>
            <textarea
              id="task-objective"
              className="text-area"
              value={taskObjective}
              onChange={(event) => setTaskObjective(event.target.value)}
              placeholder="The production build, links, and launch copy have all been verified."
            />
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
              {busy ? "Opening..." : "Open task"}
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
              <span>{activeTrapper.contextCount} context items attached</span>
            </div>
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
              Add to task
              <Plus size={17} />
            </button>
            <div className="sheet-divider" />
            <button
              className="primary-command full"
              disabled={busy}
              onClick={() => void closeTrapper()}
            >
              {busy ? "Closing..." : "Close task and issue receipt"}
              <FileCheck2 size={18} />
            </button>
          </section>
        </div>
      )}
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

function TodayView({
  openTrappers,
  receipts,
  onNew,
  onOpen,
  onProof,
}: {
  openTrappers: Trapper[];
  receipts: Receipt[];
  onNew: () => void;
  onOpen: (id: string) => void;
  onProof: () => void;
}) {
  return (
    <div className="view-content">
      <section className="command-band">
        <div>
          <p className="eyebrow">Ready for the next job</p>
          <h2>What should your agents work on?</h2>
        </div>
        <button className="primary-command" onClick={onNew}>
          <Plus size={18} />
          Open a task
        </button>
      </section>

      <section className="metric-strip">
        <div>
          <span>{openTrappers.length}</span>
          <small>Open tasks</small>
        </div>
        <div>
          <span>{receipts.length}</span>
          <small>Receipts</small>
        </div>
        <div>
          <span>{openTrappers.reduce((sum, item) => sum + item.contextCount, 0)}</span>
          <small>Context items</small>
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">In progress</p>
            <h2>Open tasks</h2>
          </div>
        </div>
        {openTrappers.length ? (
          <div className="task-list">
            {openTrappers.slice(0, 3).map((trapper) => (
              <TaskRow key={trapper.id} trapper={trapper} onOpen={onOpen} />
            ))}
          </div>
        ) : (
          <EmptyTask onNew={onNew} />
        )}
      </section>

      {receipts[0] && (
        <section className="latest-proof">
          <ShieldCheck size={25} />
          <div>
            <p className="eyebrow">Latest proof</p>
            <strong>
              {String(
                receipts[0].payload.title ??
                  receipts[0].payload.result ??
                  "Task completed",
              )}
            </strong>
            <small>{receipts[0].hash}</small>
          </div>
          <button className="secondary-command" onClick={onProof}>
            View proof
          </button>
        </section>
      )}
    </div>
  );
}

function TrappersView({
  openTrappers,
  closedTrappers,
  onNew,
  onOpen,
}: {
  openTrappers: Trapper[];
  closedTrappers: Trapper[];
  onNew: () => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="view-content">
      <div className="view-title">
        <div>
          <p className="eyebrow">Bounded work</p>
          <h2>Tasks</h2>
        </div>
        <button className="primary-command" onClick={onNew}>
          <Plus size={18} />
          Open task
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
              <TaskRow key={trapper.id} trapper={trapper} onOpen={onOpen} />
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
              <TaskRow key={trapper.id} trapper={trapper} onOpen={onOpen} />
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
}: {
  trapper: Trapper;
  onOpen: (id: string) => void;
}) {
  return (
    <button className="task-row" onClick={() => onOpen(trapper.id)}>
      <span className={`task-state ${trapper.status}`}>
        {trapper.status === "closed" ? <Check size={16} /> : <CircleDot size={16} />}
      </span>
      <span className="task-copy">
        <strong>{trapper.title}</strong>
        <small>
          {trapper.contextCount} context items · {trapper.riskLevel} risk
        </small>
      </span>
      <span className="task-time">{formatTime(trapper.createdAt)}</span>
      <ChevronRight size={18} />
    </button>
  );
}

function EmptyTask({ onNew }: { onNew: () => void }) {
  return (
    <div className="plain-empty compact">
      <FolderKanban size={28} />
      <h3>No open tasks.</h3>
      <button className="text-command" onClick={onNew}>
        Open the first one
      </button>
    </div>
  );
}
