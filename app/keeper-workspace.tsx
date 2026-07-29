"use client";

import {
  ArrowRight,
  Check,
  Clipboard,
  FileText,
  FolderGit2,
  Github,
  Link2,
  PackageOpen,
  Plus,
  Send,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { AddSourceInput } from "./keeper-library";
import type { KeeperState, SourceItem, SourceKind, Trapper } from "./keeper-types";

type CaptureMode = SourceKind | null;

export function KeeperWorkspace({
  state,
  busy,
  onAddSource,
  onPrepareTrapper,
  onOpenTrapper,
  onShareTrapper,
  onOpenSourceLab,
}: {
  state: KeeperState;
  busy: boolean;
  onAddSource: (input: AddSourceInput) => Promise<void>;
  onPrepareTrapper: (sourceIds: string[]) => void;
  onOpenTrapper: (trapperId: string) => void;
  onShareTrapper: (trapper: Trapper) => Promise<void>;
  onOpenSourceLab: () => void;
}) {
  const [captureMode, setCaptureMode] = useState<CaptureMode>(null);
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceSummary, setSourceSummary] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [actionError, setActionError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const openTrappers = state.trappers.filter((item) => item.status === "open");
  const sourceMap = useMemo(
    () => new Map(state.sources.map((source) => [source.id, source])),
    [state.sources],
  );

  function resetCapture() {
    setCaptureMode(null);
    setSourceTitle("");
    setSourceSummary("");
    setSourceUrl("");
    setActionError("");
  }

  async function submitSource() {
    if (!captureMode) return;
    setActionError("");
    try {
      await onAddSource({
        kind: captureMode,
        title: sourceTitle,
        summary: sourceSummary,
        ...(captureMode === "link" || captureMode === "repository"
          ? { url: sourceUrl }
          : {}),
      });
      resetCapture();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "That source could not be captured.",
      );
    }
  }

  async function captureFile(file: File | undefined) {
    if (!file) return;
    setActionError("");
    try {
      if (file.size > 2_000_000) {
        throw new Error("For this beta, files must be 2 MB or smaller.");
      }
      const isReadableText =
        file.type.startsWith("text/") ||
        /\.(md|mdx|txt|json|csv|tsv|js|jsx|ts|tsx|css|html|xml|yaml|yml)$/i.test(
          file.name,
        );
      const contentExcerpt = isReadableText ? (await file.text()).slice(0, 12_000) : "";
      await onAddSource({
        kind: "file",
        title: file.name,
        summary: isReadableText
          ? "Readable file captured with a local text excerpt."
          : "File reference captured. Full binary upload is coming after private storage is enabled.",
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        contentExcerpt,
      });
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "That file could not be captured.",
      );
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function toggleSource(sourceId: string) {
    setSelectedSourceIds((current) =>
      current.includes(sourceId)
        ? current.filter((item) => item !== sourceId)
        : [...current, sourceId],
    );
  }

  function beginTrapper() {
    onPrepareTrapper(selectedSourceIds);
    setSelectedSourceIds([]);
  }

  return (
    <div className="source-first-workspace">
      <section className="source-hero">
        <div className="source-hero-copy">
          <span className="source-hero-kicker">
            <Sparkles size={16} />
            SOURCE-POWERED WORKSPACE
          </span>
          <h2>Catch the good stuff. Send it ready.</h2>
          <p>
            Drop in research, links, files, and public repositories. Select what matters,
            wrap it in a Trapper, and hand the whole context to a person or agent.
          </p>
        </div>
        <div className="capture-launcher" aria-label="Capture a source">
          <button onClick={() => setCaptureMode("link")}>
            <Link2 size={21} />
            <span>Paste a link</span>
            <small>Article, video, document</small>
          </button>
          <button onClick={() => setCaptureMode("note")}>
            <Clipboard size={21} />
            <span>Quick note</span>
            <small>Idea, instruction, decision</small>
          </button>
          <button onClick={() => setCaptureMode("repository")}>
            <Github size={21} />
            <span>Clone GitHub</span>
            <small>Pin and index a public repo</small>
          </button>
          <button onClick={() => fileRef.current?.click()}>
            <Upload size={21} />
            <span>Upload a file</span>
            <small>Text and lightweight docs</small>
          </button>
          <input
            ref={fileRef}
            className="visually-hidden"
            type="file"
            onChange={(event) => void captureFile(event.target.files?.[0])}
          />
        </div>
      </section>

      {actionError && (
        <p className="inline-error source-inline-error" role="alert">
          {actionError}
        </p>
      )}

      {captureMode && (
        <section className="quick-capture-panel" aria-label="Quick source capture">
          <div className="quick-capture-heading">
            <div>
              <span className={`source-token ${captureMode}`}>
                {captureMode === "repository" ? (
                  <Github size={17} />
                ) : captureMode === "link" ? (
                  <Link2 size={17} />
                ) : (
                  <Clipboard size={17} />
                )}
                {captureMode === "repository" ? "GitHub snapshot" : captureMode}
              </span>
              <strong>
                {captureMode === "repository"
                  ? "Clone a public repository into this Keeper"
                  : captureMode === "link"
                    ? "Save something from the web"
                    : "Catch a thought before it gets away"}
              </strong>
            </div>
            <button
              className="icon-command"
              aria-label="Close source capture"
              onClick={resetCapture}
            >
              <X size={18} />
            </button>
          </div>
          {(captureMode === "link" || captureMode === "repository") && (
            <label>
              <span>{captureMode === "repository" ? "Public GitHub URL" : "Web address"}</span>
              <input
                className="text-field"
                type="url"
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                placeholder={
                  captureMode === "repository"
                    ? "https://github.com/owner/repository"
                    : "https://example.com/useful-source"
                }
              />
            </label>
          )}
          <div className="quick-capture-grid">
            <label>
              <span>Title</span>
              <input
                className="text-field"
                value={sourceTitle}
                maxLength={120}
                onChange={(event) => setSourceTitle(event.target.value)}
                placeholder={
                  captureMode === "repository" ? "Repository name" : "What should we call it?"
                }
              />
            </label>
            <label>
              <span>{captureMode === "note" ? "Your note" : "Why it matters"}</span>
              <textarea
                className="text-area"
                value={sourceSummary}
                maxLength={4_000}
                onChange={(event) => setSourceSummary(event.target.value)}
                placeholder="Give the next person or agent the useful context."
              />
            </label>
          </div>
          <button
            className="primary-command"
            disabled={
              busy ||
              sourceTitle.trim().length < 2 ||
              sourceSummary.trim().length < 2 ||
              ((captureMode === "link" || captureMode === "repository") &&
                !sourceUrl.trim())
            }
            onClick={() => void submitSource()}
          >
            {busy
              ? "Catching..."
              : captureMode === "repository"
                ? "Clone snapshot"
                : "Catch source"}
            <ArrowRight size={17} />
          </button>
        </section>
      )}

      <section className="trapper-builder-band">
        <div className="band-heading">
          <div>
            <p className="eyebrow">THE SOURCE DOCK</p>
            <h3>Select what travels together</h3>
          </div>
          <button className="text-command" onClick={onOpenSourceLab}>
            Open source lab
            <ArrowRight size={16} />
          </button>
        </div>

        {state.sources.length ? (
          <>
            <div className="source-card-strip">
              {state.sources.slice(0, 12).map((source, index) => {
                const selected = selectedSourceIds.includes(source.id);
                return (
                  <button
                    className={`source-block ${source.kind} ${selected ? "selected" : ""}`}
                    key={source.id}
                    onClick={() => toggleSource(source.id)}
                    aria-pressed={selected}
                  >
                    <span className="source-block-number">
                      {selected ? <Check size={15} /> : String(index + 1).padStart(2, "0")}
                    </span>
                    <SourceGlyph source={source} />
                    <strong>{source.title}</strong>
                    <p>{source.summary}</p>
                    <SourceMeta source={source} />
                  </button>
                );
              })}
              <button className="source-block add-more" onClick={onOpenSourceLab}>
                <Plus size={26} />
                <strong>All sources</strong>
                <p>Connect, inspect, and build deeper packs.</p>
              </button>
            </div>
            <div className={`trap-selection-bar ${selectedSourceIds.length ? "active" : ""}`}>
              <div>
                <PackageOpen size={20} />
                <span>
                  {selectedSourceIds.length
                    ? `${selectedSourceIds.length} source${
                        selectedSourceIds.length === 1 ? "" : "s"
                      } ready to trap`
                    : "Pick sources to build a portable Trapper"}
                </span>
              </div>
              <button
                className="primary-command"
                disabled={!selectedSourceIds.length}
                onClick={beginTrapper}
              >
                Build Trapper
                <ArrowRight size={17} />
              </button>
            </div>
          </>
        ) : (
          <div className="source-empty-stage">
            <div className="empty-orbit" aria-hidden="true">
              <span />
              <span />
              <span />
              <PackageOpen size={32} />
            </div>
            <h3>Your first Trapper starts with something worth carrying.</h3>
            <p>Paste a link, write a note, upload a file, or clone a public repository.</p>
          </div>
        )}
      </section>

      <section className="trapper-canvas-section">
        <div className="band-heading">
          <div>
            <p className="eyebrow">TRAPPER CANVAS</p>
            <h3>Portable context in motion</h3>
          </div>
          <button className="primary-command" onClick={() => onPrepareTrapper([])}>
            <Plus size={17} />
            New Trapper
          </button>
        </div>

        {openTrappers.length ? (
          <div className="trapper-canvas">
            {openTrappers.map((trapper, index) => {
              const attachedSources = trapper.sourceIds
                .map((sourceId) => sourceMap.get(sourceId))
                .filter((source): source is SourceItem => Boolean(source));
              return (
                <article className={`trapper-tile accent-${index % 4}`} key={trapper.id}>
                  <div className="trapper-tape" aria-hidden="true" />
                  <div className="trapper-tile-top">
                    <span className={`risk-pill ${trapper.riskLevel}`}>
                      {trapper.riskLevel}
                    </span>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                  </div>
                  <button
                    className="trapper-open-area"
                    onClick={() => onOpenTrapper(trapper.id)}
                  >
                    <h4>{trapper.title}</h4>
                    <p>{trapper.objective}</p>
                  </button>
                  <div className="mini-source-stack">
                    {attachedSources.length ? (
                      attachedSources.slice(0, 4).map((source) => (
                        <span key={source.id} title={source.title}>
                          <SourceGlyph source={source} compact />
                        </span>
                      ))
                    ) : (
                      <small>No sources attached yet</small>
                    )}
                    {attachedSources.length > 4 && (
                      <small>+{attachedSources.length - 4}</small>
                    )}
                  </div>
                  <footer>
                    <span>{trapper.sourceIds.length} sources</span>
                    <button
                      className="trapper-share-button"
                      onClick={() => void onShareTrapper(trapper)}
                    >
                      <Send size={15} />
                      Share
                    </button>
                  </footer>
                </article>
              );
            })}
            <button className="new-trapper-tile" onClick={() => onPrepareTrapper([])}>
              <Plus size={30} />
              <strong>Build another Trapper</strong>
              <span>Bundle sources, instructions, and proof.</span>
            </button>
          </div>
        ) : (
          <div className="trapper-empty">
            <PackageOpen size={36} />
            <div>
              <h3>No Trappers in motion yet.</h3>
              <p>Select sources above, then package them for a person or agent.</p>
            </div>
            <button className="primary-command" onClick={() => onPrepareTrapper([])}>
              Build the first one
              <ArrowRight size={17} />
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function SourceGlyph({ source, compact = false }: { source: SourceItem; compact?: boolean }) {
  const size = compact ? 16 : 21;
  if (source.kind === "repository") return <FolderGit2 size={size} />;
  if (source.kind === "link") return <Link2 size={size} />;
  if (source.kind === "file") return <FileText size={size} />;
  return <Clipboard size={size} />;
}

function SourceMeta({ source }: { source: SourceItem }) {
  if (source.snapshot) {
    return (
      <small>
        {source.snapshot.fileCount} files · {source.snapshot.defaultBranch} ·{" "}
        {source.snapshot.commitSha.slice(0, 7)}
      </small>
    );
  }
  if (source.fileName) return <small>{source.mimeType ?? "file"}</small>;
  if (source.url) {
    let hostname = "web source";
    try {
      hostname = new URL(source.url).hostname;
    } catch {}
    return <small>{hostname}</small>;
  }
  return <small>note</small>;
}
