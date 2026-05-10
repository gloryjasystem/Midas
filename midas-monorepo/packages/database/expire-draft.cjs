const pg = require('pg');
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
c.connect()
  .then(() => c.query(`UPDATE transaction_drafts SET status = 'expired', updated_at = NOW() WHERE workspace_id = '01KR3MS834M7EZ7B4ZMWF0VJPM' AND status IN ('pending_user', 'needs_clarification')`))
  .then(r => { console.log('Expired:', r.rowCount); return c.end(); })
  .catch(e => { console.error(e); c.end(); });
