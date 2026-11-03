import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(packageDirectory, "../../..");
const source = path.join(root, "apps/web/dist");
const target = path.join(packageDirectory, "../web-dist");

try {
  await mkdir(target, { recursive: true });
  const sourceAssets = new Set(await readdir(path.join(source, "assets")));
  const oldAssets = await readdir(path.join(target, "assets")).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  for (const asset of oldAssets) {
    if (/^index-[\w-]+\.(?:js|css)$/.test(asset) && !sourceAssets.has(asset)) {
      await rm(path.join(target, "assets", asset));
    }
  }
  await cp(source, target, { recursive: true, force: true });
  console.log(`Copied dashboard assets to ${target}`);
} catch (error) {
  if (error?.code === "ENOENT") {
    console.warn("Dashboard build not found; CLI package built without web-dist.");
  } else {
    throw error;
  }
}

for (const name of ["README.md", "LICENSE"]) {
  try {
    await cp(path.join(root, name), path.join(packageDirectory, "..", name));
  } catch (error) {
    if (error?.code === "ENOENT") {
      console.warn(
        `${name} is missing from the repository root; the CLI is not ready for publication.`,
      );
    } else {
      throw error;
    }
  }
}
