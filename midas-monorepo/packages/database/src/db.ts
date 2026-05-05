import pg from 'pg';
import { Decimal } from 'decimal.js';

// SEC-02: Decimal Boundary Rule
// Parse PostgreSQL NUMERIC (OID 1700) as Decimal
pg.types.setTypeParser(1700, (val: string) => new Decimal(val));

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://midas_app:midas_app_password@localhost:5432/midas',
});

// For graceful shutdown
export const closeDb = async () => {
  await pool.end();
};
