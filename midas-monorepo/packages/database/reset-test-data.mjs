/**
 * reset-test-data.mjs — Сброс всех пользовательских данных
 *
 * ⚠️  ТОЛЬКО ДАННЫЕ. Схема, таблицы, типы, миграции — НЕ ТРОГАЮТСЯ.
 *
 * Удаляет в правильном порядке (с учётом FK):
 *   1. transactions
 *   2. transaction_drafts
 *   3. account_sources
 *   4. categories
 *   5. workspace_memberships
 *   6. workspaces
 *   7. users
 *
 * Run: DATABASE_URL=<url> node reset-test-data.mjs
 * или: node reset-test-data.mjs  (использует Railway proxy по умолчанию)
 */

import pg from 'pg';
const { Pool } = pg;

const DB_URL = process.env.DATABASE_URL
  ?? 'postgresql://postgres:PLLSqArtPUoQsAYmvrpsmavfQMewgTRh@hopper.proxy.rlwy.net:46284/railway';

const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });

async function resetTestData() {
  const client = await pool.connect();
  try {
    console.log('🔄 Начинаем сброс пользовательских данных...\n');

    // Считаем до удаления для отчёта
    const counts = {};
    const tables = [
      'transactions',
      'transaction_drafts',
      'account_sources',
      'categories',
      'workspace_memberships',
      'workspaces',
      'users',
    ];

    for (const t of tables) {
      const r = await client.query(`SELECT COUNT(*)::INT AS cnt FROM ${t}`);
      counts[t] = r.rows[0].cnt;
    }

    console.log('📊 Данные перед удалением:');
    for (const [t, cnt] of Object.entries(counts)) {
      console.log(`   ${t}: ${cnt} строк`);
    }

    if (Object.values(counts).every(c => c === 0)) {
      console.log('\n✅ База уже пуста. Нечего удалять.');
      return;
    }

    console.log('\n🗑️  Удаляю данные...');

    await client.query('BEGIN');

    // Порядок важен — от зависимых к корневым
    await client.query(`DELETE FROM transactions`);
    console.log(`   ✓ transactions`);

    await client.query(`DELETE FROM transaction_drafts`);
    console.log(`   ✓ transaction_drafts`);

    await client.query(`DELETE FROM account_sources`);
    console.log(`   ✓ account_sources`);

    await client.query(`DELETE FROM categories`);
    console.log(`   ✓ categories`);

    await client.query(`DELETE FROM workspace_memberships`);
    console.log(`   ✓ workspace_memberships`);

    await client.query(`DELETE FROM workspaces`);
    console.log(`   ✓ workspaces`);

    await client.query(`DELETE FROM users`);
    console.log(`   ✓ users`);

    await client.query('COMMIT');

    // Проверяем что всё чисто
    console.log('\n📊 Данные после удаления:');
    for (const t of tables) {
      const r = await client.query(`SELECT COUNT(*)::INT AS cnt FROM ${t}`);
      console.log(`   ${t}: ${r.rows[0].cnt} строк`);
    }

    // Проверяем что структура цела
    const structureCheck = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    console.log(`\n✅ Структура цела — ${structureCheck.rows.length} таблиц сохранено`);
    console.log('\n🎉 Сброс завершён. База готова к чистому тестированию.');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Ошибка при сбросе:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

resetTestData();
