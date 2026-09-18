/** Database access: schema, typed client, migrations, and the session credential store. */
export { createDatabase, type Database } from './client.js';
export { PostgresAuthStateStore } from './auth-state-store.js';
export { inspectDatabaseSecurity, setTenant, type DatabaseSecurityReport } from './security-check.js';
export { verifySchema, type SchemaCheckResult } from './schema-check.js';
export * as schema from './schema.js';
