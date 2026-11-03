export {
  generateDocumentation,
  DocumentationError,
  GENERATED_MARKER,
} from "./markdown/generate.js";
export {
  compareSnapshots,
  formatDriftReport,
  type FormatDriftReportOptions,
} from "./drift/compare.js";
export {
  DriftError,
  type DriftCategory,
  type DriftChange,
  type DriftChangeType,
  type DriftCounts,
  type DriftFieldChange,
  type DriftReport,
  type DriftSide,
  type DriftSummary,
  type GenerateDocumentationOptions,
  type GenerateDocumentationResult,
} from "./types.js";
