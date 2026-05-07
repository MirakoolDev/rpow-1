import { parseEnv } from './env.js';
import { createPool, runMigrations } from './db.js';
import { buildApp } from './buildApp.js';

const env = parseEnv();
const pool = createPool(env.DATABASE_URL);
await runMigrations(pool);

const app = await buildApp({ pool });
await app.listen({ host: '0.0.0.0', port: env.PORT });
app.log.info(`rpow2 server listening on :${env.PORT}`);
