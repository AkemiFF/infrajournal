import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { infrajournalConfigSchema } from "../src/config/schema.js";
import { snapshotSchema } from "../src/model/schema.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(directory, "..", "schema");
await fs.mkdir(output, { recursive: true });

const snapshotJsonSchema = z.toJSONSchema(snapshotSchema, {
  target: "draft-2020-12",
  io: "output",
});
const configJsonSchema = z.toJSONSchema(infrajournalConfigSchema, {
  target: "draft-2020-12",
  io: "input",
});

const snapshotDocument = {
  $id: "https://infrajournal.dev/schema/snapshot-1.0.0.json",
  title: "InfraJournal Snapshot",
  description:
    "Versioned infrastructure snapshot produced by InfraJournal. Paths are relative to the scan root.",
  ...(snapshotJsonSchema as Record<string, unknown>),
};
const configDocument = {
  $id: "https://infrajournal.dev/schema/config-1.json",
  title: "InfraJournal Configuration",
  description: "Configuration schema for infrajournal.yml.",
  ...(configJsonSchema as Record<string, unknown>),
};

await fs.writeFile(
  path.join(output, "snapshot.schema.json"),
  `${JSON.stringify(snapshotDocument, null, 2)}\n`,
);
await fs.writeFile(
  path.join(output, "config.schema.json"),
  `${JSON.stringify(configDocument, null, 2)}\n`,
);
console.log(`Wrote ${path.join(output, "snapshot.schema.json")}`);
console.log(`Wrote ${path.join(output, "config.schema.json")}`);
