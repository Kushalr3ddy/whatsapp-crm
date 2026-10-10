/** Domain logic. Depends on ports and the database, never on a concrete adapter. */
export {
  storeInboundMessage, markMessageSent, markMessageFailed, applyDeliveryStatus,
  type InboundMessage, type StoredInbound
} from './messages.js';

export {
  createSession, resolveSession, revokeSession, revokeAllSessionsForUser, secretsMatch,
  type SessionPrincipal, type IssuedSession
} from './sessions.js';

export {
  issueApiKey, resolveApiKey, revokeApiKey, listApiKeys, API_SCOPES,
  type KeyPrincipal, type IssuedKey, type ApiScope
} from './api-keys.js';

export {
  createOrgWithAdmin, addUserToOrg, setPassword, AlreadyExistsError,
  type ProvisionedOrg
} from './provisioning.js';

export {
  writeAudit, writeAuditInTenant, SYSTEM_ACTOR, AUDIT,
  type AuditActor, type AuditEntry, type ActorType
} from './audit.js';

export {
  storeMedia, storeOutboundMedia, resolveMedia,
  type OutboundUpload, type IncomingMedia, type StoredMedia, type ResolvedMedia
} from './media.js';

export {
  checkSendAllowance, dailyCeiling, humanDelayMs,
  circadianActivity, circadianDelayMs, localHour, CIRCADIAN_QUIET_THRESHOLD,
  RECONNECT_RAMP_MS, RECONNECT_PER_MINUTE,
  type PacingLimits, type PacingDecision
} from './pacing.js';

export {
  checkContactGraph, classifyRelationship, relationshipDelayMultiplier,
  newContactDailyAllowance, DEFAULT_REPLY_FLOOR, type ReplyFloorConfig,
  type Relationship, type ContactGraphLimits, type ContactGraphDecision
} from './contact-graph.js';

export { typingDelayMs } from './typing.js';

export { renderBody, resolveSpintax, fillVariables } from './body-variation.js';

export {
  buildSegmentPredicate, countSegmentMatches, type SegmentDefinition
} from './segments.js';

export {
  recoveryState, openRecovery, beginRecovery, isRecoveryIncident,
  type RecoveryIncident, type RecoveryRow, type RecoveryState
} from './recovery.js';

export {
  computeRiskScore, riskBand, nextStatus, deliveryRatio, deliveryDelayMultiplier,
  scoreSenderHealth, scoreConnectedSenders,
  type SenderStatus, type RiskBand, type HealthSignals, type HealthResult
} from './health.js';

export {
  DecryptFailureTracker, markDecryptBurst, decryptBurstIsLive,
  DECRYPT_BURST_COUNT, DECRYPT_BURST_WINDOW_MS, DECRYPT_BURST_LIVE_MS
} from './decrypt-failures.js';

export {
  csvCell, csvHeader, csvLine, vcardEntry, fetchExportBatch, EXPORT_COLUMNS, type ExportRow
} from './contact-export.js';

export { timezoneForPhone, COUNTRY_TIMEZONES } from './recipient-timezone.js';

export {
  EntropyScheduler, entropyPlan, nextEntropyDelayMs, ENTROPY_MIN_INTERVAL_MS, ENTROPY_MAX_INTERVAL_MS,
  type EntropyPlan, type Rng
} from './entropy.js';

export {
  readDelayMs, readIsDue, READ_DELAY_MIN_MS, READ_DELAY_MAX_MS, READ_MAX_AGE_MS
} from './read-receipts.js';

export {
  runImport,
  type ImportMapping, type ImportSummary, type RowOutcome, type Transform, type TenantWork
} from './ingestion.js';

export {
  campaignProgress, previewAudience, forecast, snapshotAudience, dispatchCampaign,
  reconcileCampaign,
  type CampaignProgress, type AudiencePreview, type CampaignForecast
} from './campaigns.js';
export {
  searchPredicate, resolveTarget, countMatching, bulkTag, bulkUntag, tagImportRun, ensureTag,
  type TagTarget
} from './tagging.js';
export {
  CUSTOM_FIELD_TYPES, FIELD_KEY, checkFieldValue, validateCustomFields, loadCustomFields,
  type CustomFieldDef, type CustomFieldType
} from './custom-fields.js';
export {
  POLICY_GATES, POLICY_SKIP_REASON, ENGAGEMENT_WINDOW_HOURS, COOLDOWN_DAYS, isPolicyGate,
  blockingPolicyGate, type PolicyGate
} from './policy-gates.js';
export { markMessageFailedByProviderId } from './messages.js';
export { linkLidToPhone, type LinkOutcome } from './identity-linking.js';
export {
  classifyRestriction, nextRestrictionState, gatherRestrictionStats, checkRestriction, recordHealthEvent,
  STUCK_AFTER_MS, HOLD_MS, MIN_SENDS,
  type RestrictionState, type RestrictionStats, type RestrictionVerdict, type RestrictionSignal, type RestrictionOutcome
} from './restriction.js';
