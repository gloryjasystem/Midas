import { pool } from '@midas/database';

async function resetStuckDraft() {
  console.log('Connecting to database...');
  try {
    const res = await pool.query(`
      UPDATE transaction_drafts 
      SET status = 'rejected' 
      WHERE status = 'pending_user' 
        AND workspace_id = '01KRG94D3BR4R1HKZYTHXD31VT'
      RETURNING id, status, created_at;
    `);
    
    console.log(`Successfully reset ${res.rowCount} stuck drafts.`);
    for (const row of res.rows) {
      console.log(`- Draft ${row.id} set to ${row.status}`);
    }
  } catch (err) {
    console.error('Error resetting draft:', err);
  } finally {
    await pool.end();
  }
}

resetStuckDraft();
