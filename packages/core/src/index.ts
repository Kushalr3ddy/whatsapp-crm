/** Domain logic. Depends on ports and the database, never on a concrete adapter. */
export {
  storeInboundMessage, storeOwnMessage, markMessageSent, markMessageFailed, applyDeliveryStatus, sentMessageText, requestRead,
  type InboundMessage, type OwnMessage, type StoredInbound
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
  createOrgWithAdmin, addUserToOrg, setPassword, AlreadyExistsError, EmailUnavailableError,
  type ProvisionedOrg
} from './provisioning.js';

export {
  listMembers, changeMember, resetMemberPassword, MemberNotFoundError, MemberRuleError,
  type Member
} from './team.js';

export {
  getAiSettings, saveAiSettings, auditLlmChange, AiSettingsRuleError,
  type AiSettings, type AiSettingsChange
} from './ai-settings.js';

export {
  storeCampaignPicture, listCampaignPictures, getCampaignPicture, findCampaignPictures, resolveSendAsset, resolveCampaignPicture,
  CampaignPictureError, CAMPAIGN_PICTURE_MAX_BYTES, type CampaignPicture, type SendAsset
} from './campaign-media.js';
export { gifToMp4, GifConversionError } from './media-convert.js';

export {
  generateTemplate, parseGenerated, listTemplates, getTemplate, saveTemplate, useTemplate, deleteTemplate, listDeletedTemplates, restoreTemplate, removeTemplateNow, duplicateTemplate, TEMPLATE_KEEP_DAYS,
  AiTemplateError, AI_ALWAYS_ON_RULES, AI_TEMPLATE_MAX_DESCRIPTION,
  type AiTemplate, type AiTemplateInput, type TemplateQuestion, type SensitiveDetail, buildInstructions, type GeneratedTemplate
} from './ai-templates.js';

export {
  createCampaignDraft, startCampaign, setCampaignStatus, editCampaign,
  type ActionContext, type CampaignAudience, type NewCampaign, type StartedCampaign, type BlankFillInChoice
} from './campaign-actions.js';

export {
  enqueueAiJob, listAiJobs, cancelAiJob, claimNextAiJob, finishAiJob, tidyAiJobs, AiJobError,
  type AiJob, type AiJobKind, type AiJobStatus, type ClaimedJob, type QueueViewer
} from './ai-jobs.js';

export {
  runAiCommand, AiCommandError, type CommandAction, type CommandResult
} from './ai-commands.js';

export { autoReply, getAiNotice, systemText, type AutoReplyResult, type AiNotice } from './ai-reply.js';
export { parseAiTurn, recordTurn, listCampaignAiStatus, AI_STATUSES, type AiTurn, type AiStatus, type CampaignAiStatus } from './ai-turn.js';

export {
  writeAudit, writeAuditInTenant, SYSTEM_ACTOR, AUDIT,
  type AuditActor, type AuditEntry, type ActorType
} from './audit.js';

export {
  storeMedia, storeOutboundMedia, resolveMedia,
  type OutboundUpload, type IncomingMedia, type StoredMedia, type ResolvedMedia
} from './media.js';

export {
  HOLD_REASONS, LANE_PRIORITIES,
  type AntiBanPolicy, type SendContext, type SendDecision, type BatchContext, type Hold, type HoldReason, type LanePriority,
  type NumberState, type QuietHoursSetting, type SendMessage, type CappingStatus
} from './antiban.js';
export * from './antiban/constants.js';
export { makeAntiBanPolicy, gapFactorFor } from './antiban/policy.js';
export { drawGapMs, typingMs, laneWaitMs, startsRun, seededRandom } from './antiban/gap.js';
export { quietHoursEnd } from './antiban/quiet-hours.js';
export { reactionBrakeOn, type NewChatOutcomes } from './antiban/brake.js';
export { numberHints, type NumberHint } from './antiban/hints.js';
export { splitFirstMessage, hasVariation, type FirstMessageSplit } from './antiban/first-message.js';
export { renderRecipientBody, planFirstMessage, type RecipientText } from './antiban/campaign-text.js';
export { contactHoldOf, numberHoldOf, recordHold, clearHold, type Queryable } from './antiban/holds.js';
export {
  laneCandidates, loadNumberState, loadQuietHours, lastSentAtOf, storedWarnings, newChatOutcomes, newChatsSince,
  type LaneCandidate, type StoredWarnings
} from './antiban/lane-state.js';
export { applyWhatsAppNotice, type WhatsAppNotice, type TimelockNotice, type CappingNotice } from './antiban/notices.js';
export { computeEta, campaignEta, type Eta, type EtaDelay, type EtaInput, type EtaItem } from './antiban/eta.js';
export { queueCampaignFollowUp } from './campaign-followup.js';
export { recordHealthEvent } from './health-events.js';
export { judgeUnreached, deliversFast, stuckDecision, type ProfileSeen, type ProfileSnapshot, type UnreachedVerdict } from './antiban/ticks.js';
export {
  checkUnreached, snapshotDue, saveSnapshot, conversationOfSent, stuckCount, reviewManyUndelivered, resumeNumber,
  type ProbeFn, type UnreachedResult
} from './antiban/delivery-check.js';
export { isDecryptWave } from './antiban/decrypt.js';
export { registerRetryRequest, liftRetryOnReceipt, contactWroteAgain, type RetryOutcome } from './antiban/retry-state.js';
export { decryptWaveActive } from './antiban/holds.js';
export {
  matchesStopWord, matchesRestartWord, looksNegative, buildClosingMessage, type ClosingMessageParts
} from './antiban/optout.js';
export {
  handleInboundSafety, markOptOut, OPT_OUT_REASON,
  type InboundSafetyInput, type InboundSafetyResult, type OptOutDeps, type OptOutResult
} from './antiban/opt-out.js';
export {
  loadAntiBanSettings, saveAntiBanSettings, missingContactDetails, cleanWords,
  type AntiBanSettings, type AntiBanSettingsPatch
} from './antiban/settings.js';

export {
  renderBody, resolveSpintax, fillVariables, fillInKeys, usedFillIns, unknownFillIns, suggestFillIn, blankFillIns, BUILTIN_FILL_INS
} from './body-variation.js';

export {
  buildSegmentPredicate, segmentCriteria, countSegmentMatches, countSegmentCriteria,
  type SegmentDefinition, type FieldRule, type FieldRuleOp
} from './segments.js';

export {
  DecryptFailureTracker, markDecryptBurst, markOwnDecryptBurst, recordRetryRequest,
  DECRYPT_BURST_COUNT, DECRYPT_BURST_WINDOW_MS
} from './decrypt-failures.js';

export {
  csvCell, csvHeader, csvLine, vcardEntry, fetchExportBatch, EXPORT_COLUMNS, type ExportRow
} from './contact-export.js';

export {
  runImport,
  type ImportMapping, joinName, type ImportSummary, type RowOutcome, type Transform, type TenantWork
} from './ingestion.js';

export {
  campaignProgress, previewAudience, snapshotAudience, dispatchCampaign, fillInReport, sampleText,
  reconcileCampaign,
  type CampaignProgress, type AudiencePreview, type FillInReport, type FillInReportField, type FillInAudience
} from './campaigns.js';
export {
  reviewCampaign, resolveTargetContactIds, audienceColumnsFromTargets, blankFillInPeople, audienceHistory,
  type AudienceColumns, type ReviewTarget, type CampaignReview, type ReviewPerson, type BlankPerson, type AudienceHistory
} from './campaign-review.js';
export {
  searchPredicate, resolveTarget, countMatching, bulkTag, bulkTagIds, bulkUntag, tagImportRun, ensureTag, deleteTag, isFileTag,
  type TagTarget, type ContactFilter
} from './tagging.js';
export {
  CUSTOM_FIELD_TYPES, FIELD_KEY, checkFieldValue, validateCustomFields, loadCustomFields,
  type CustomFieldDef, type CustomFieldType
} from './custom-fields.js';
export {
  POLICY_GATES, POLICY_SKIP_REASON, ENGAGEMENT_WINDOW_HOURS, COOLDOWN_DAYS, isPolicyGate,
  blockingPolicyGate, type PolicyGate
} from './policy-gates.js';
export { markMessageFailedByProviderId, markUnconfirmedSends, UNCONFIRMED_AFTER_MS } from './messages.js';
export {
  classifyLinkFailure, linkErrorFor, encodeLinkError, decodeLinkError,
  type LinkErrorInfo, type LinkErrorCode
} from './link-errors.js';
export { linkLidToPhone, type LinkOutcome } from './identity-linking.js';
export {
  keyVersionCounts, versionsMissingFromKeyRing, reencryptBatch, verifySample, assertKeyRingCoversData,
  type KeyVersionCounts, type ReencryptResult, type VerifyResult, type SqlExecutor
} from './key-rotation.js';
export { claimCampaignReply, campaignTemplateFor } from './campaign-reply.js';
export { writeOpenings, campaignWritesOpenings } from './ai-opening.js';

export { writeExample, suggestFillIns, detectSensitive, rewriteKnowledge, parseExample, type ExampleDraft, type ExampleLine, type FillInSuggestion, type SensitiveCandidate } from './ai-example.js';
export { recordAiRun, estimateAiCredits, campaignAiUsage, stopCampaignAi, listAiUsage, AI_ASSUMED_REPLIES, type CampaignAiUsage, type AiRunInput, type AiUsageLog, type AiActivity, type AiUsagePart } from './ai-usage.js';
