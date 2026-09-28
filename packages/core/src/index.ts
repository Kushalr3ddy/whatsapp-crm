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
  storeMedia, resolveMedia,
  type IncomingMedia, type StoredMedia, type ResolvedMedia
} from './media.js';

export {
  checkSendAllowance, dailyCeiling, humanDelayMs,
  circadianActivity, circadianDelayMs, localHour,
  type PacingLimits, type PacingDecision
} from './pacing.js';

export {
  checkContactGraph, classifyRelationship, relationshipDelayMultiplier,
  type Relationship, type ContactGraphLimits, type ContactGraphDecision
} from './contact-graph.js';

export {
  computeRiskScore, riskBand, nextStatus, deliveryRatio,
  scoreSenderHealth, scoreConnectedSenders,
  type SenderStatus, type RiskBand, type HealthSignals, type HealthResult
} from './health.js';

export {
  runImport,
  type ImportMapping, type ImportSummary, type RowOutcome, type Transform, type TenantWork
} from './ingestion.js';

export {
  campaignProgress, forecast, snapshotAudience, dispatchCampaign, reconcileCampaign,
  type CampaignProgress, type CampaignForecast
} from './campaigns.js';
