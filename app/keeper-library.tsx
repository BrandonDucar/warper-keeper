"use client";

import {
  ArrowRight,
  Box,
  Download,
  FileJson,
  GitBranch,
  Link2,
  Network,
  NotebookPen,
  PackageCheck,
  Plus,
  Upload,
} from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import type {
  KeeperState,
  ProofDrop,
  SourceItem,
  SourceKind,
  Trapper,
} from "./keeper-types";

export type AddSourceInput = {
  kind: SourceKind;
  title: string;
  summary: string;
  url?: string;
};

export function KeeperLibrary({
  state,
  busy,
  onAddSource,
  onAddRelation,
  onBuildProofDrop,
  onAttachToTask,
  onExport,
  onImport,
}: {
  state: KeeperState;
  busy: boolean;
  onAddSource: (input: AddSourceInput) => Promise<void>;
  onAddRelation: (fromId: string, toId: string, label: string) => Promise<void>;
  onBuildProofDrop: (
    title: string,
    purpose: string,
    sourceIds: string[],
  ) => Promise<void>;
  onAttachToTask: (source: SourceItem, task: Trapper) => Promise<void>;
  onExport: () => void;
  onImport: (value: unknown) => Promise<void>;
}) {
  const [panel, setPanel] = useState<"sources" | "connections" | "packs">("sources");
  const [showSourceForm, setShowSourceForm] = useState(false);
  const [sourceKind, setSourceKind] = useState<SourceKind>("note");
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceSummary, setSourceSummary] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [relationLabel, setRelationLabel] = useState("supports");
  const [packTitle, setPackTitle] = useState("");
  const [packPurpose, setPackPurpose] = useState("");
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [taskBySource, setTaskBySource] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState("");
  const importRef = useRef<HTMLInputElement>(null);
  const openTasks = state.trappers.filter((item) => item.status === "open");

  const sourceMap = useMemo(
    () => new Map(state.sources.map((source) => [source.id, source])),
    [state.sources],
  );

  async function submitSource() {
    setActionError("");
    try {
      await onAddSource({
        kind: sourceKind,
        title: sourceTitle,
        summary: sourceSummary,
        ...(sourceKind === "link" || sourceKind === "repository"
          ? { url: sourceUrl }
          : {}),
      });
      setSourceTitle("");
      setSourceSummary("");
      setSourceUrl("");
      setShowSourceForm(false);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "The source could not be added.",
      );
    }
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    setActionError("");
    try {
      if (file.size > 1_000_000) throw new Error("Keeper import exceeds 1 MB.");
      await onImport(JSON.parse(await file.text()));
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "That Keeper file could not be read.",
      );
    } finally {
      if (importRef.current) importRef.current.value = "";
    }
  }

  async function submitRelation() {
    setActionError("");
    try {
      await onAddRelation(fromId, toId, relationLabel);
      setFromId("");
      setToId("");
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "The connection could not be saved.",
      );
    }
  }

  async function submitProofDrop() {
    setActionError("");
    try {
      await onBuildProofDrop(packTitle, packPurpose, selectedSources);
      setPackTitle("");
      setPackPurpose("");
      setSelectedSources([]);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "The context pack could not be built.",
      );
    }
  }

  return (
    <div className="view-content library-workspace">
      <div className="view-title">
        <div>
          <p className="eyebrow">Portable working context</p>
          <h2>Library</h2>
        </div>
        <div className="library-actions">
          <input
            ref={importRef}
            type="file"
            accept="application/json"
            className="visually-hidden"
            onChange={(event) => void importFile(event.target.files?.[0])}
          />
          <button
            className="icon-command"
            aria-label="Import Keeper JSON"
            title="Import Keeper JSON"
            onClick={() => importRef.current?.click()}
          >
            <Upload size={18} />
          </button>
          <button
            className="icon-command"
            aria-label="Export Keeper JSON"
            title="Export Keeper JSON"
            onClick={onExport}
          >
            <Download size={18} />
          </button>
          <button
            className="primary-command"
            onClick={() => setShowSourceForm((value) => !value)}
          >
            <Plus size={18} />
            Add source
          </button>
        </div>
      </div>

      <div className="library-tabs" role="tablist" aria-label="Library sections">
        <button
          role="tab"
          aria-selected={panel === "sources"}
          className={panel === "sources" ? "active" : ""}
          onClick={() => setPanel("sources")}
        >
          <NotebookPen size={17} />
          Sources <span>{state.sources.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={panel === "connections"}
          className={panel === "connections" ? "active" : ""}
          onClick={() => setPanel("connections")}
        >
          <Network size={17} />
          Connections <span>{state.relations.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={panel === "packs"}
          className={panel === "packs" ? "active" : ""}
          onClick={() => setPanel("packs")}
        >
          <PackageCheck size={17} />
          Context packs <span>{state.proofDrops.length}</span>
        </button>
      </div>

      {actionError && (
        <p className="inline-error" role="alert">
          {actionError}
        </p>
      )}

      {showSourceForm && (
        <section className="library-editor" aria-label="Add source">
          <div className="source-kind-control" aria-label="Source type">
            {(["note", "link", "repository"] as SourceKind[]).map((kind) => (
              <button
                type="button"
                key={kind}
                className={sourceKind === kind ? "active" : ""}
                onClick={() => setSourceKind(kind)}
              >
                {kind === "note" ? (
                  <NotebookPen size={17} />
                ) : kind === "link" ? (
                  <Link2 size={17} />
                ) : (
                  <GitBranch size={17} />
                )}
                {kind === "repository" ? "GitHub" : kind}
              </button>
            ))}
          </div>
          <label className="field-label" htmlFor="source-title">
            Title
          </label>
          <input
            id="source-title"
            className="text-field"
            value={sourceTitle}
            maxLength={120}
            onChange={(event) => setSourceTitle(event.target.value)}
            placeholder="Launch requirements"
          />
          {(sourceKind === "link" || sourceKind === "repository") && (
            <>
              <label className="field-label" htmlFor="source-url">
                {sourceKind === "repository" ? "Public GitHub URL" : "Source URL"}
              </label>
              <input
                id="source-url"
                className="text-field"
                type="url"
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                placeholder={
                  sourceKind === "repository"
                    ? "https://github.com/owner/repository"
                    : "https://example.com/source"
                }
              />
            </>
          )}
          <label className="field-label" htmlFor="source-summary">
            {sourceKind === "note" ? "Note" : "Why it matters"}
          </label>
          <textarea
            id="source-summary"
            className="text-area"
            value={sourceSummary}
            maxLength={4_000}
            onChange={(event) => setSourceSummary(event.target.value)}
            placeholder="Capture the useful part, decision, or boundary."
          />
          <button
            className="primary-command"
            disabled={
              busy ||
              sourceTitle.trim().length < 2 ||
              sourceSummary.trim().length < 2 ||
              ((sourceKind === "link" || sourceKind === "repository") &&
                !sourceUrl.trim())
            }
            onClick={() => void submitSource()}
          >
            {sourceKind === "repository" ? "Inspect and add" : "Add to library"}
            <ArrowRight size={17} />
          </button>
        </section>
      )}

      {panel === "sources" &&
        (state.sources.length ? (
          <div className="source-list">
            {state.sources.map((source) => (
              <article className="source-row" key={source.id}>
                <span className={`source-icon ${source.kind}`}>
                  {source.kind === "note" ? (
                    <NotebookPen size={19} />
                  ) : source.kind === "link" ? (
                    <Link2 size={19} />
                  ) : (
                    <GitBranch size={19} />
                  )}
                </span>
                <div className="source-copy">
                  <div>
                    <strong>{source.title}</strong>
                    <span>{source.kind === "repository" ? "GitHub" : source.kind}</span>
                  </div>
                  <p>{source.summary}</p>
                  {source.url && (
                    <a href={source.url} target="_blank" rel="noreferrer">
                      {source.url}
                    </a>
                  )}
                  {source.commitSha && <code>{source.commitSha}</code>}
                </div>
                {openTasks.length > 0 && (
                  <div className="source-attach">
                    <select
                      aria-label={`Task for ${source.title}`}
                      value={taskBySource[source.id] ?? openTasks[0]?.id}
                      onChange={(event) =>
                        setTaskBySource((current) => ({
                          ...current,
                          [source.id]: event.target.value,
                        }))
                      }
                    >
                      {openTasks.map((task) => (
                        <option key={task.id} value={task.id}>
                          {task.title}
                        </option>
                      ))}
                    </select>
                    <button
                      className="icon-command"
                      aria-label={`Attach ${source.title} to task`}
                      title="Attach to task"
                      onClick={() => {
                        const taskId = taskBySource[source.id] ?? openTasks[0]?.id;
                        const task = openTasks.find((item) => item.id === taskId);
                        if (task) void onAttachToTask(source, task);
                      }}
                    >
                      <Plus size={17} />
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : (
          <LibraryEmpty
            icon={<NotebookPen size={28} />}
            title="Bring in the first useful source."
            action="Add source"
            onAction={() => setShowSourceForm(true)}
          />
        ))}

      {panel === "connections" && (
        <section className="connection-workspace">
          {state.sources.length >= 2 ? (
            <div className="connection-builder">
              <select
                aria-label="First source"
                value={fromId}
                onChange={(event) => setFromId(event.target.value)}
              >
                <option value="">Choose source</option>
                {state.sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.title}
                  </option>
                ))}
              </select>
              <input
                aria-label="Relationship"
                value={relationLabel}
                maxLength={42}
                onChange={(event) => setRelationLabel(event.target.value)}
              />
              <select
                aria-label="Second source"
                value={toId}
                onChange={(event) => setToId(event.target.value)}
              >
                <option value="">Choose source</option>
                {state.sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.title}
                  </option>
                ))}
              </select>
              <button
                className="primary-command"
                disabled={!fromId || !toId || fromId === toId || !relationLabel.trim() || busy}
                onClick={() => void submitRelation()}
              >
                Connect
              </button>
            </div>
          ) : (
            <LibraryEmpty
              icon={<Network size={28} />}
              title="Add two sources to connect them."
              action="Add source"
              onAction={() => {
                setPanel("sources");
                setShowSourceForm(true);
              }}
            />
          )}
          {state.relations.length > 0 && (
            <div className="relation-list">
              {state.relations.map((relation) => (
                <div key={relation.id}>
                  <strong>{sourceMap.get(relation.fromSourceId)?.title ?? "Source"}</strong>
                  <span>{relation.label}</span>
                  <strong>{sourceMap.get(relation.toSourceId)?.title ?? "Source"}</strong>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {panel === "packs" && (
        <section className="pack-workspace">
          {state.sources.length ? (
            <div className="pack-builder">
              <label className="field-label" htmlFor="pack-title">
                Pack name
              </label>
              <input
                id="pack-title"
                className="text-field"
                value={packTitle}
                maxLength={120}
                onChange={(event) => setPackTitle(event.target.value)}
                placeholder="Launch context pack"
              />
              <label className="field-label" htmlFor="pack-purpose">
                Purpose
              </label>
              <textarea
                id="pack-purpose"
                className="text-area"
                value={packPurpose}
                maxLength={1_000}
                onChange={(event) => setPackPurpose(event.target.value)}
                placeholder="What should an agent be able to do with this context?"
              />
              <div className="source-checklist">
                {state.sources.map((source) => (
                  <label key={source.id}>
                    <input
                      type="checkbox"
                      checked={selectedSources.includes(source.id)}
                      onChange={(event) =>
                        setSelectedSources((current) =>
                          event.target.checked
                            ? [...current, source.id]
                            : current.filter((id) => id !== source.id),
                        )
                      }
                    />
                    <span>{source.title}</span>
                    <small>{source.kind}</small>
                  </label>
                ))}
              </div>
              <button
                className="primary-command"
                disabled={
                  busy ||
                  packTitle.trim().length < 2 ||
                  packPurpose.trim().length < 4 ||
                  selectedSources.length === 0
                }
                onClick={() => void submitProofDrop()}
              >
                <PackageCheck size={18} />
                Build proofed pack
              </button>
            </div>
          ) : (
            <LibraryEmpty
              icon={<Box size={28} />}
              title="A context pack starts with a source."
              action="Add source"
              onAction={() => {
                setPanel("sources");
                setShowSourceForm(true);
              }}
            />
          )}
          {state.proofDrops.length > 0 && (
            <div className="pack-list">
              {state.proofDrops.map((drop) => (
                <ProofDropRow key={drop.id} drop={drop} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function ProofDropRow({ drop }: { drop: ProofDrop }) {
  return (
    <article className="pack-row">
      <span>
        <PackageCheck size={20} />
      </span>
      <div>
        <strong>{drop.title}</strong>
        <p>{drop.purpose}</p>
        <code>{drop.hash}</code>
      </div>
      <small>{drop.sourceIds.length} sources</small>
    </article>
  );
}

function LibraryEmpty({
  icon,
  title,
  action,
  onAction,
}: {
  icon: ReactNode;
  title: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="plain-empty">
      {icon}
      <h3>{title}</h3>
      <button className="secondary-command" onClick={onAction}>
        {action}
      </button>
    </div>
  );
}

export function ProofDropList({
  drops,
  onDownload,
}: {
  drops: ProofDrop[];
  onDownload: (drop: ProofDrop) => void;
}) {
  if (!drops.length) return null;
  return (
    <section className="proof-drop-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Portable evidence</p>
          <h3>Proof Drops</h3>
        </div>
        <span>{drops.length}</span>
      </div>
      <div className="receipt-list">
        {drops.map((drop) => (
          <article className="receipt-card" key={drop.id}>
            <div className="receipt-mark">
              <PackageCheck size={22} />
            </div>
            <div className="receipt-copy">
              <div>
                <strong>{drop.title}</strong>
                <span>{drop.sourceIds.length} sources</span>
              </div>
              <code>{drop.hash}</code>
              <small>{drop.purpose}</small>
            </div>
            <button
              className="icon-command"
              aria-label={`Download ${drop.title}`}
              title="Download Proof Drop"
              onClick={() => onDownload(drop)}
            >
              <FileJson size={18} />
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
