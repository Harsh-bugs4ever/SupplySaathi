import { loadEnvFiles } from '../src/lib/config/loadEnvFile';

loadEnvFiles();
import { getDb, migrate } from '../src/lib/db/client';
import { getOrCreateProfile } from '../src/lib/db/repo';
import { loadConfig } from '../src/lib/config/load';

const cfg = loadConfig();
const db = getDb();
const ran = migrate(db);

if (ran.length) {
  console.log(`Applied ${ran.length} migration(s): ${ran.join(', ')}`);
} else {
  console.log('Database already up to date.');
}

const profile = getOrCreateProfile(db);
console.log(`Database ready at ${cfg.databasePath}`);
console.log(`Business profile: ${profile.businessName} (${profile.id})`);
