/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.sql(`
    -- Enable RLS
    ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
    ALTER TABLE users ENABLE ROW LEVEL SECURITY;
    ALTER TABLE workspace_memberships ENABLE ROW LEVEL SECURITY;
    ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
    ALTER TABLE persons ENABLE ROW LEVEL SECURITY;
    ALTER TABLE account_sources ENABLE ROW LEVEL SECURITY;
    -- exchange_rate_snapshots is global, no RLS
    ALTER TABLE transaction_drafts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE loans ENABLE ROW LEVEL SECURITY;
    ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

    -- Helper function to safely get settings
    CREATE OR REPLACE FUNCTION current_workspace_id() RETURNS VARCHAR(26) AS $$
      SELECT current_setting('app.workspace_id', true)::VARCHAR(26);
    $$ LANGUAGE sql STABLE;

    CREATE OR REPLACE FUNCTION current_user_id() RETURNS VARCHAR(26) AS $$
      SELECT current_setting('app.user_id', true)::VARCHAR(26);
    $$ LANGUAGE sql STABLE;

    -- RLS Policies
    
    -- Users: Can read/write their own record
    CREATE POLICY users_isolation ON users
      FOR ALL
      TO midas_app
      USING (id = current_user_id())
      WITH CHECK (id = current_user_id());

    -- Workspaces: Can access if they are a member
    CREATE POLICY workspaces_isolation ON workspaces
      FOR ALL
      TO midas_app
      USING (id IN (
        SELECT workspace_id FROM workspace_memberships WHERE user_id = current_user_id()
      ));

    -- Workspace Memberships: Can access their own memberships
    CREATE POLICY workspace_memberships_isolation ON workspace_memberships
      FOR ALL
      TO midas_app
      USING (user_id = current_user_id());

    -- Tenant Scoped Entities (Categories, Persons, Account Sources, Drafts, Transactions, Loans, Audit Logs)
    -- They use the currently injected app.workspace_id
    CREATE POLICY tenant_isolation_categories ON categories
      FOR ALL TO midas_app
      USING (workspace_id = current_workspace_id())
      WITH CHECK (workspace_id = current_workspace_id());

    CREATE POLICY tenant_isolation_persons ON persons
      FOR ALL TO midas_app
      USING (workspace_id = current_workspace_id())
      WITH CHECK (workspace_id = current_workspace_id());

    CREATE POLICY tenant_isolation_account_sources ON account_sources
      FOR ALL TO midas_app
      USING (workspace_id = current_workspace_id())
      WITH CHECK (workspace_id = current_workspace_id());

    CREATE POLICY tenant_isolation_transaction_drafts ON transaction_drafts
      FOR ALL TO midas_app
      USING (workspace_id = current_workspace_id())
      WITH CHECK (workspace_id = current_workspace_id());

    CREATE POLICY tenant_isolation_transactions ON transactions
      FOR ALL TO midas_app
      USING (workspace_id = current_workspace_id())
      WITH CHECK (workspace_id = current_workspace_id());

    CREATE POLICY tenant_isolation_loans ON loans
      FOR ALL TO midas_app
      USING (workspace_id = current_workspace_id())
      WITH CHECK (workspace_id = current_workspace_id());

    CREATE POLICY tenant_isolation_audit_logs ON audit_logs
      FOR SELECT TO midas_app
      USING (workspace_id = current_workspace_id());

    CREATE POLICY tenant_isolation_audit_logs_insert ON audit_logs
      FOR INSERT TO midas_app
      WITH CHECK (workspace_id = current_workspace_id());

    -- SECURITY DEFINER Function for Onboarding
    -- This allows the system to create the initial user, workspace, and membership securely
    CREATE OR REPLACE FUNCTION system_create_onboarding_workspace(
      p_user_id VARCHAR(26),
      p_telegram_id BIGINT,
      p_workspace_id VARCHAR(26),
      p_workspace_name TEXT,
      p_membership_id VARCHAR(26)
    ) RETURNS VOID AS $$
    BEGIN
      INSERT INTO users (id, telegram_id) VALUES (p_user_id, p_telegram_id)
        ON CONFLICT (telegram_id) DO NOTHING;
      
      INSERT INTO workspaces (id, name, default_currency) VALUES (p_workspace_id, p_workspace_name, 'RUB');
      
      INSERT INTO workspace_memberships (id, user_id, workspace_id, role, is_default)
        VALUES (p_membership_id, p_user_id, p_workspace_id, 'owner', true);
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER;
    
    -- Restrict execution of the SECURITY DEFINER function to midas_app (and migrator)
    REVOKE ALL ON FUNCTION system_create_onboarding_workspace FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION system_create_onboarding_workspace TO midas_app;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP FUNCTION IF EXISTS system_create_onboarding_workspace;
    DROP FUNCTION IF EXISTS current_user_id;
    DROP FUNCTION IF EXISTS current_workspace_id;

    DROP POLICY IF EXISTS tenant_isolation_audit_logs_insert ON audit_logs;
    DROP POLICY IF EXISTS tenant_isolation_audit_logs ON audit_logs;
    DROP POLICY IF EXISTS tenant_isolation_loans ON loans;
    DROP POLICY IF EXISTS tenant_isolation_transactions ON transactions;
    DROP POLICY IF EXISTS tenant_isolation_transaction_drafts ON transaction_drafts;
    DROP POLICY IF EXISTS tenant_isolation_account_sources ON account_sources;
    DROP POLICY IF EXISTS tenant_isolation_persons ON persons;
    DROP POLICY IF EXISTS tenant_isolation_categories ON categories;
    DROP POLICY IF EXISTS workspace_memberships_isolation ON workspace_memberships;
    DROP POLICY IF EXISTS workspaces_isolation ON workspaces;
    DROP POLICY IF EXISTS users_isolation ON users;

    ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY;
    ALTER TABLE loans DISABLE ROW LEVEL SECURITY;
    ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;
    ALTER TABLE transaction_drafts DISABLE ROW LEVEL SECURITY;
    ALTER TABLE account_sources DISABLE ROW LEVEL SECURITY;
    ALTER TABLE persons DISABLE ROW LEVEL SECURITY;
    ALTER TABLE categories DISABLE ROW LEVEL SECURITY;
    ALTER TABLE workspace_memberships DISABLE ROW LEVEL SECURITY;
    ALTER TABLE users DISABLE ROW LEVEL SECURITY;
    ALTER TABLE workspaces DISABLE ROW LEVEL SECURITY;
  `);
};
