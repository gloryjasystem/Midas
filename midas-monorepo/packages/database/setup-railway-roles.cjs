// Run with: node packages/database/setup-railway-roles.cjs
// Creates midas_app and midas_migrator roles on Railway PostgreSQL

const pg = require('pg');
const PG_URL = process.env.DATABASE_URL || process.argv[2];

if (!PG_URL) {
  console.error('Usage: DATABASE_URL=... node setup-railway-roles.cjs');
  process.exit(1);
}

const client = new pg.Client({ connectionString: PG_URL });

const commands = [
  `DO $$ BEGIN
    CREATE ROLE midas_migrator WITH LOGIN PASSWORD 'midas_migrator_password';
  EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'Role midas_migrator already exists';
  END $$;`,

  `DO $$ BEGIN
    CREATE ROLE midas_app WITH LOGIN PASSWORD 'midas_app_password';
  EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'Role midas_app already exists';
  END $$;`,

  `GRANT ALL ON SCHEMA public TO midas_migrator;`,
  `REVOKE ALL ON SCHEMA public FROM public;`,
  `GRANT USAGE ON SCHEMA public TO midas_app;`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO midas_app;`,

  `ALTER DEFAULT PRIVILEGES FOR ROLE midas_migrator IN SCHEMA public
     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO midas_app;`,

  `ALTER DEFAULT PRIVILEGES FOR ROLE midas_migrator IN SCHEMA public
     GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO midas_app;`,
];

async function run() {
  await client.connect();
  console.log('✅ Connected to Railway PostgreSQL');

  for (const sql of commands) {
    try {
      await client.query(sql);
      console.log('  OK:', sql.slice(0, 60).replace(/\s+/g, ' ').trim(), '...');
    } catch (e) {
      console.error('  ERR:', e.message);
    }
  }

  await client.end();
  console.log('✅ Done — roles ready');
}

run().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
