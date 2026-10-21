/** Database access: schema, typed client, migrations, and the session credential store. */
export { createDatabase, type Database, type Transaction } from './client.js';
export { PostgresAuthStateStore } from './auth-state-store.js';
export {
  inspectDatabaseSecurity, setTenant, assumeRole, resolveTenantRole, TENANT_ROLE,
  type DatabaseSecurityReport
} from './security-check.js';
export { tenantDatabase } from './tenant-database.js';
export { verifySchema, type SchemaCheckResult } from './schema-check.js';
export * as schema from './schema.js';
export { TABLE_NOTES, type TableNote } from './table-notes.js';
