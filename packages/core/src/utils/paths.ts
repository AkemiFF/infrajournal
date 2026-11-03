import path from "node:path";

export function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

export function relativePosix(root: string, absolutePath: string): string {
  return toPosixPath(path.relative(root, absolutePath));
}

export function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function realpathIfExists(value: string): Promise<string | undefined> {
  const fs = await import("node:fs/promises");
  try {
    return await fs.realpath(value);
  } catch {
    return undefined;
  }
}

export function hasTraversalSegment(value: string): boolean {
  return value.split(/[\\/]+/).includes("..");
}
