import fs from "node:fs/promises";

export type TextReadResult =
  { ok: true; text: string } | { ok: false; reason: "too-large" | "binary" | "read" };

export async function readUntrustedText(
  absolutePath: string,
  maxFileSizeBytes: number,
): Promise<TextReadResult> {
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(absolutePath);
  } catch {
    return { ok: false, reason: "read" };
  }
  if (buffer.length > maxFileSizeBytes) return { ok: false, reason: "too-large" };
  if (buffer.subarray(0, 8192).includes(0)) return { ok: false, reason: "binary" };
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  return { ok: true, text };
}
