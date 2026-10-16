import type { MensagemWebchat } from "./types";

export const WEBCHAT_MAX_MEDIA_BYTES = 10 * 1024 * 1024;

const mimetypes = {
  "image/jpeg": { kind: "image", ext: "jpg" },
  "image/png": { kind: "image", ext: "png" },
  "image/webp": { kind: "image", ext: "webp" },
  "image/gif": { kind: "image", ext: "gif" },
  "audio/webm": { kind: "audio", ext: "webm" },
  "audio/ogg": { kind: "audio", ext: "ogg" },
  "audio/mpeg": { kind: "audio", ext: "mp3" },
  "audio/mp4": { kind: "audio", ext: "m4a" },
  "audio/wav": { kind: "audio", ext: "wav" },
} as const;

export function validarMidiaWebchat(mimeRaw: string, bytes: Uint8Array) {
  const raw = mimeRaw.split(";")[0]?.trim().toLowerCase();
  const mime = raw === "audio/x-m4a" ? "audio/mp4" : raw;
  const spec = mimetypes[mime as keyof typeof mimetypes];
  if (!spec || bytes.length === 0 || bytes.length > WEBCHAT_MAX_MEDIA_BYTES) return null;
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  const valid = mime === "image/jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : mime === "image/png" ? ascii(1, 4) === "PNG"
    : mime === "image/webp" ? ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP"
    : mime === "image/gif" ? ascii(0, 3) === "GIF"
    : mime === "audio/webm" ? bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3
    : mime === "audio/ogg" ? ascii(0, 4) === "OggS"
    : mime === "audio/mpeg" ? ascii(0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0)
    : mime === "audio/mp4" ? ascii(4, 8) === "ftyp"
    : mime === "audio/wav" ? ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE"
    : false;
  return valid ? { ...spec, mime } : null;
}

export function tipoDeAnexoWebchat(item: MensagemWebchat): "image" | "audio" | null {
  return item.type === "image" || item.type === "audio" ? item.type : null;
}
