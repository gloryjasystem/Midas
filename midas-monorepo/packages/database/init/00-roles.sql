-- Create roles
CREATE ROLE midas_migrator WITH LOGIN PASSWORD 'midas_migrator_password';
CREATE ROLE midas_app WITH LOGIN PASSWORD 'midas_app_password';

-- Restrict midas_app
GRANT ALL ON SCHEMA public TO midas_migrator;
REVOKE ALL ON SCHEMA public FROM public;
GRANT USAGE ON SCHEMA public TO midas_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO midas_app;

-- Ensure midas_app gets privileges on future tables created by midas_migrator
ALTER DEFAULT PRIVILEGES FOR ROLE midas_migrator IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO midas_app;

ALTER DEFAULT PRIVILEGES FOR ROLE midas_migrator IN SCHEMA public
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO midas_app;
