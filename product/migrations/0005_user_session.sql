-- 0005: user sessions for sign-in. The product sends email and WhatsApp
-- messages on the user's behalf, so use of the live API requires a signed-in
-- identity. Only a SHA-256 hash of the cookie token is stored.
CREATE TABLE IF NOT EXISTS user_session (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT,
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_session_email ON user_session(email);
CREATE INDEX IF NOT EXISTS idx_user_session_expiry ON user_session(expires_at);
