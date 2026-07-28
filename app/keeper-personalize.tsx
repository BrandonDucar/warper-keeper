"use client";

import { Palette, RotateCcw, Sticker, X } from "lucide-react";
import { useState, type CSSProperties } from "react";
import type {
  KeeperPersonalization,
  KeeperTheme,
} from "./keeper-types";

const themes: Array<{
  id: KeeperTheme;
  label: string;
  description: string;
  front: string;
  accent: string;
  second: string;
}> = [
  {
    id: "signal",
    label: "Signal",
    description: "Mint and cyan on deep green",
    front: "#0d1917",
    accent: "#61e6b2",
    second: "#54c7d4",
  },
  {
    id: "voltage",
    label: "Voltage",
    description: "Coral and cyan on near black",
    front: "#191117",
    accent: "#ff836d",
    second: "#54c7d4",
  },
  {
    id: "archive",
    label: "Archive",
    description: "Amber and coral on forest",
    front: "#151d18",
    accent: "#f2bc66",
    second: "#ff836d",
  },
];

const stickerOptions = ["WK", "PROOF", "★", "✦", "⚡", "✓", "∞"];

export function KeeperPersonalize({
  keeperName,
  value,
  busy,
  onSave,
  onClose,
}: {
  keeperName: string;
  value: KeeperPersonalization;
  busy: boolean;
  onSave: (value: KeeperPersonalization) => Promise<void>;
  onClose: () => void;
}) {
  const [theme, setTheme] = useState<KeeperTheme>(value.theme);
  const [tagline, setTagline] = useState(value.tagline);
  const [stickers, setStickers] = useState(value.stickers);
  const [customSticker, setCustomSticker] = useState("");
  const selectedTheme = themes.find((item) => item.id === theme) ?? themes[0];

  function addSticker(sticker: string) {
    const clean = sticker.trim().toUpperCase().slice(0, 10);
    if (!clean) return;
    setStickers((current) => [...current, clean].slice(-8));
  }

  return (
    <div className="sheet-backdrop" role="presentation">
      <section
        className="task-sheet personalize-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="personalize-title"
      >
        <div className="sheet-header">
          <div>
            <p className="eyebrow">Make it yours</p>
            <h2 id="personalize-title">Personalize Keeper</h2>
          </div>
          <button className="icon-command" aria-label="Close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div
          className="keeper-cover-preview"
          style={
            {
              "--cover-front": selectedTheme.front,
              "--cover-accent": selectedTheme.accent,
              "--cover-second": selectedTheme.second,
            } as CSSProperties
          }
        >
          <small>WARPER KEEPER</small>
          <strong>{keeperName}</strong>
          <p>{tagline || "Working context, ready to move."}</p>
          <div className="cover-stickers" aria-label="Selected stickers">
            {stickers.map((sticker, index) => (
              <span key={`${sticker}-${index}`}>{sticker}</span>
            ))}
          </div>
        </div>

        <fieldset className="theme-picker">
          <legend>
            <Palette size={16} />
            Cover
          </legend>
          <div>
            {themes.map((item) => (
              <button
                type="button"
                key={item.id}
                className={theme === item.id ? "selected" : ""}
                onClick={() => setTheme(item.id)}
              >
                <span className="theme-swatches" aria-hidden="true">
                  <i style={{ background: item.front }} />
                  <i style={{ background: item.accent }} />
                  <i style={{ background: item.second }} />
                </span>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </button>
            ))}
          </div>
        </fieldset>

        <label className="field-label" htmlFor="keeper-tagline">
          Cover line
        </label>
        <input
          id="keeper-tagline"
          className="text-field"
          maxLength={80}
          value={tagline}
          onChange={(event) => setTagline(event.target.value)}
          placeholder="Working context, ready to move."
        />

        <fieldset className="keeper-sticker-picker">
          <legend>
            <Sticker size={16} />
            Stickers
          </legend>
          <div className="sticker-options">
            {stickerOptions.map((sticker) => (
              <button
                type="button"
                key={sticker}
                title={`Add ${sticker} sticker`}
                onClick={() => addSticker(sticker)}
              >
                {sticker}
              </button>
            ))}
            <button
              type="button"
              title="Remove last sticker"
              onClick={() => setStickers((current) => current.slice(0, -1))}
            >
              <RotateCcw size={16} />
            </button>
          </div>
          <label htmlFor="custom-sticker">Custom word</label>
          <div className="custom-sticker">
            <input
              id="custom-sticker"
              maxLength={10}
              value={customSticker}
              onChange={(event) => setCustomSticker(event.target.value)}
              placeholder="SHIP"
            />
            <button
              type="button"
              className="secondary-command"
              disabled={!customSticker.trim()}
              onClick={() => {
                addSticker(customSticker);
                setCustomSticker("");
              }}
            >
              Add
            </button>
          </div>
        </fieldset>

        <button
          className="primary-command full"
          disabled={busy}
          onClick={() =>
            void onSave({
              theme,
              tagline: tagline.trim(),
              stickers,
            })
          }
        >
          <Palette size={18} />
          {busy ? "Saving..." : "Save personalization"}
        </button>
      </section>
    </div>
  );
}
