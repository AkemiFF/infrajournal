import { isMap, isScalar, isSeq, type LineCounter, type Node, type Pair } from "yaml";

export function lineOf(lineCounter: LineCounter, node: unknown): number | undefined {
  if (
    node !== null &&
    typeof node === "object" &&
    "range" in node &&
    Array.isArray((node as { range?: unknown }).range)
  ) {
    const range = (node as { range: [number, number, number] }).range;
    return lineCounter.linePos(range[0]).line;
  }
  return undefined;
}

export function columnOf(lineCounter: LineCounter, node: unknown): number | undefined {
  if (
    node !== null &&
    typeof node === "object" &&
    "range" in node &&
    Array.isArray((node as { range?: unknown }).range)
  ) {
    const range = (node as { range: [number, number, number] }).range;
    return lineCounter.linePos(range[0]).col;
  }
  return undefined;
}

export function mapPairs(node: unknown): Pair[] {
  if (!isMap(node)) return [];
  return node.items;
}

export function pairKey(pair: Pair): string | undefined {
  return isScalar(pair.key) && pair.key.value !== null ? String(pair.key.value) : undefined;
}

export function scalarString(node: unknown): string | undefined {
  if (isScalar(node)) {
    const value = node.value;
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return undefined;
}

export function sequenceNodes(node: unknown): Node[] {
  if (!isSeq(node)) return [];
  return node.items.filter((item): item is Node => item !== null && typeof item === "object");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asStringArray(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item : undefined))
    .filter((item): item is string => item !== undefined);
}

export function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}
