"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { cropImage, type CropRect } from "@/lib/image-prepare";

type Handle = "move" | "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";
const MIN = 0.08; // tamaño mínimo del recorte (fracción)
const FULL: CropRect = { x: 0, y: 0, w: 1, h: 1 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function applyDrag(start: CropRect, handle: Handle, dx: number, dy: number): CropRect {
  if (handle === "move") {
    return { ...start, x: clamp(start.x + dx, 0, 1 - start.w), y: clamp(start.y + dy, 0, 1 - start.h) };
  }
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  if (handle.includes("w")) left = clamp(left + dx, 0, right - MIN);
  if (handle.includes("e")) right = clamp(right + dx, left + MIN, 1);
  if (handle.includes("n")) top = clamp(top + dy, 0, bottom - MIN);
  if (handle.includes("s")) bottom = clamp(bottom + dy, top + MIN, 1);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

const HANDLES: { id: Handle; style: React.CSSProperties }[] = [
  { id: "nw", style: { left: 0, top: 0, cursor: "nwse-resize" } },
  { id: "n", style: { left: "50%", top: 0, cursor: "ns-resize" } },
  { id: "ne", style: { left: "100%", top: 0, cursor: "nesw-resize" } },
  { id: "e", style: { left: "100%", top: "50%", cursor: "ew-resize" } },
  { id: "se", style: { left: "100%", top: "100%", cursor: "nwse-resize" } },
  { id: "s", style: { left: "50%", top: "100%", cursor: "ns-resize" } },
  { id: "sw", style: { left: 0, top: "100%", cursor: "nesw-resize" } },
  { id: "w", style: { left: 0, top: "50%", cursor: "ew-resize" } },
];

export function CropDialog({ file, onCancel, onConfirm }: { file: File; onCancel: () => void; onConfirm: (file: File) => void }) {
  const [url, setUrl] = useState("");
  const [rect, setRect] = useState<CropRect>(FULL);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ handle: Handle; start: CropRect; x: number; y: number } | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !working) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, working]);

  function down(event: ReactPointerEvent, handle: Handle) {
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = { handle, start: rect, x: event.clientX, y: event.clientY };
  }

  function move(event: ReactPointerEvent) {
    const current = drag.current;
    const box = boxRef.current;
    if (!current || !box) return;
    const bounds = box.getBoundingClientRect();
    setRect(applyDrag(current.start, current.handle, (event.clientX - current.x) / bounds.width, (event.clientY - current.y) / bounds.height));
  }

  function up() {
    drag.current = null;
  }

  async function confirm(useFull: boolean) {
    setWorking(true);
    setError("");
    try {
      onConfirm(useFull ? file : await cropImage(file, rect));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo recortar la foto.");
      setWorking(false);
    }
  }

  const pct = (value: number) => `${value * 100}%`;

  return (
    <div role="dialog" aria-modal="true" aria-label="Recortar foto del ticket" style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.85)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 16 }}>
      <p style={{ color: "#fff", margin: 0, textAlign: "center", fontSize: 15 }}>Arrastra los bordes para dejar solo el ticket</p>
      <div style={{ position: "relative", display: "inline-block", lineHeight: 0, touchAction: "none", userSelect: "none" }}>
        <div ref={boxRef} style={{ position: "relative", overflow: "hidden" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {url && <img src={url} alt="Foto del ticket para recortar" draggable={false} style={{ display: "block", maxWidth: "calc(100vw - 32px)", maxHeight: "68vh", width: "auto", height: "auto" }} />}
          <div
            onPointerDown={(event) => down(event, "move")}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            style={{ position: "absolute", left: pct(rect.x), top: pct(rect.y), width: pct(rect.w), height: pct(rect.h), boxShadow: "0 0 0 9999px rgba(0,0,0,.6)", outline: "2px solid #fff", cursor: "move", touchAction: "none" }}
          >
            {HANDLES.map((handle) => (
              <span
                key={handle.id}
                onPointerDown={(event) => down(event, handle.id)}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={up}
                style={{ position: "absolute", width: 32, height: 32, marginLeft: -16, marginTop: -16, display: "flex", alignItems: "center", justifyContent: "center", touchAction: "none", ...handle.style }}
              >
                <span style={{ width: 14, height: 14, borderRadius: 3, background: "#fff", border: "2px solid #111" }} />
              </span>
            ))}
          </div>
        </div>
      </div>
      {error && <p role="alert" style={{ color: "#ffb4b4", margin: 0 }}>{error}</p>}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
        <button type="button" className="button secondary" disabled={working} onClick={onCancel}>Cancelar</button>
        <button type="button" className="button secondary" disabled={working} onClick={() => setRect(FULL)}>Restablecer</button>
        <button type="button" className="button secondary" disabled={working} onClick={() => void confirm(true)}>Usar entera</button>
        <button type="button" className="button primary" disabled={working} onClick={() => void confirm(false)}>{working ? "Recortando…" : "Recortar y usar"}</button>
      </div>
    </div>
  );
}
