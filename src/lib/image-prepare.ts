// lib/image-prepare.ts
// Prepara la foto de un ticket en el navegador:
//  - decodifica HEIC/HEIF (iPhone) cuando el navegador puede (Safari en iPhone/Mac sí),
//  - respeta la orientación EXIF,
//  - reescala y recomprime a JPEG hasta quedar por debajo del límite,
//  - permite recortar (fracciones 0-1 de la imagen).

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // límite del backend
const TARGET_BYTES = 5 * 1024 * 1024; // margen de seguridad y subida más rápida
const MAX_SIDE = 2600; // px del lado largo: de sobra para leer un ticket
const QUALITIES = [0.88, 0.8, 0.7, 0.6];

export type CropRect = { x: number; y: number; w: number; h: number }; // fracciones 0-1

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

export function isHeic(file: Blob & { name?: string }): boolean {
  return /image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name ?? "");
}

const HEIC_ERROR = "No se ha podido leer esta foto HEIC. Prueba a abrirla en Safari o expórtala como JPEG.";

// Decodificación nativa del navegador (Safari lee HEIC; Chrome/Firefox no).
async function decodeNative(file: Blob): Promise<Decoded> {
  // 1) createImageBitmap (rápido, aplica la orientación EXIF)
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  } catch {
    // 2) fallback con <img>
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => undefined };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

async function decode(file: Blob): Promise<Decoded> {
  try {
    return await decodeNative(file);
  } catch {
    if (!isHeic(file as Blob & { name?: string })) throw new Error("No se ha podido leer la imagen. Prueba con otra foto.");
  }
  // HEIC en un navegador que no lo entiende: convertimos con una librería (se descarga solo ahora).
  try {
    const { heicTo } = await import("heic-to/next");
    const jpeg = await heicTo({ blob: file, type: "image/jpeg", quality: 0.9 });
    return await decodeNative(jpeg);
  } catch {
    throw new Error(HEIC_ERROR);
  }
}

function toJpegBlob(source: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, dw: number, dh: number, quality: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(dw));
  canvas.height = Math.max(1, Math.round(dh));
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Tu navegador no permite procesar imágenes."));
  ctx.fillStyle = "#fff"; // evita fondos negros en PNG/WebP con transparencia
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("No se pudo convertir la imagen a JPEG."))), "image/jpeg", quality);
  });
}

// Baja calidad y, si hace falta, tamaño, hasta quedar bajo TARGET_BYTES.
async function encodeUnderLimit(d: Decoded, region: { sx: number; sy: number; sw: number; sh: number }, startScale: number): Promise<Blob> {
  let scale = startScale;
  for (let round = 0; round < 6; round += 1) {
    for (const quality of QUALITIES) {
      const blob = await toJpegBlob(d.source, region.sx, region.sy, region.sw, region.sh, region.sw * scale, region.sh * scale, quality);
      if (blob.size <= TARGET_BYTES) return blob;
    }
    scale *= 0.8;
  }
  throw new Error("No se ha podido reducir la foto por debajo de 8 MB. Prueba a acercarte más al ticket.");
}

function jpegName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "") || "ticket";
  return `${base}.jpg`;
}

/** Convierte cualquier foto (incluida HEIC) en un JPEG orientado, de ≤ ~2600 px y < 8 MB. */
export async function prepareImage(file: File): Promise<File> {
  const d = await decode(file);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(d.width, d.height));
    const blob = await encodeUnderLimit(d, { sx: 0, sy: 0, sw: d.width, sh: d.height }, scale);
    return new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: Date.now() });
  } finally {
    d.release();
  }
}

/** Recorta un JPEG ya preparado. `rect` en fracciones 0-1 de la imagen. */
export async function cropImage(file: File, rect: CropRect): Promise<File> {
  const d = await decode(file);
  try {
    const sx = Math.round(rect.x * d.width);
    const sy = Math.round(rect.y * d.height);
    const sw = Math.max(1, Math.min(d.width - sx, Math.round(rect.w * d.width)));
    const sh = Math.max(1, Math.min(d.height - sy, Math.round(rect.h * d.height)));
    const blob = await encodeUnderLimit(d, { sx, sy, sw, sh }, 1);
    return new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: Date.now() });
  } finally {
    d.release();
  }
}
