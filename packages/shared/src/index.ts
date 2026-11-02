/**
 * Shared kernel: types and helpers every other package may depend on.
 * This package imports nothing of ours — it is the bottom of the dependency graph
 * (docs/04-architecture.md, the layering rule).
 */
export { loadConfig, ConfigError, type Config } from './config.js';
export { createLogger, type Logger } from './logger.js';
export { ok, err, type Result, type Ok, type Err } from './result.js';
export {
  normalisePhone, normalisePhoneCell, splitPhoneCell, isBlankMarker, phoneCountry, isMatchableIdentity,
  type PhoneError, type PhoneCellResult
} from './phone.js';
export {
  detectMediaType, safeFilename, UNKNOWN_MEDIA_TYPE, type MediaType
} from './media-type.js';
export {
  profileColumns, suggestColumns, type ColumnProfile, type ColumnSuggestions
} from './column-guess.js';
export { parseCsv, parseCsvRows, CsvError, type CsvTable } from './csv.js';
export { parseXlsxRows, rowsToCsv, looksLikeXlsx, readImportFile } from './xlsx.js';
export {
  IMPORT_LIMITS, ImportLimitError, SpreadsheetError, type ImportLimits, type ImportLimitKind
} from './import-limits.js';
