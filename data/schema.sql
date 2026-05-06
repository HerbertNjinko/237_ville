CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  full_name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  city TEXT DEFAULT '',
  state TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  registration_statement TEXT DEFAULT '',
  identity_document_name TEXT DEFAULT '',
  identity_document_type TEXT DEFAULT '',
  identity_document_size INTEGER DEFAULT 0,
  identity_document_data_url TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  membership_status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (membership_status IN ('pending_approval', 'pending_policy', 'pending_fee', 'active', 'inactive', 'suspended', 'rejected')),
  notification_opt_in BOOLEAN NOT NULL DEFAULT TRUE,
  password_must_change BOOLEAN NOT NULL DEFAULT FALSE,
  policy_accepted_at TIMESTAMPTZ,
  policy_signature_name TEXT DEFAULT '',
  policy_version TEXT DEFAULT '',
  approved_at TIMESTAMPTZ,
  approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  rejected_at TIMESTAMPTZ,
  rejected_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  rejection_reason TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_statement TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_document_name TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_document_type TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_document_size INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_document_data_url TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_must_change BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS policy_accepted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS policy_signature_name TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS policy_version TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS rejected_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS rejection_reason TEXT DEFAULT '';
ALTER TABLE users ALTER COLUMN membership_status SET DEFAULT 'pending_approval';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_membership_status_check;
ALTER TABLE users ADD CONSTRAINT users_membership_status_check CHECK (membership_status IN ('pending_approval', 'pending_policy', 'pending_fee', 'active', 'inactive', 'suspended', 'rejected'));
UPDATE users
SET
  first_name = CASE WHEN first_name = '' THEN split_part(full_name, ' ', 1) ELSE first_name END,
  last_name = CASE
    WHEN last_name = '' AND position(' ' in full_name) > 0 THEN substring(full_name from position(' ' in full_name) + 1)
    ELSE last_name
  END;

CREATE TABLE IF NOT EXISTS sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS announcements (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'announcement',
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  location TEXT DEFAULT '',
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS member_questions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL DEFAULT 'question' CHECK (content_type IN ('question', 'article')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'closed')),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE member_questions ADD COLUMN IF NOT EXISTS content_type TEXT NOT NULL DEFAULT 'question';
ALTER TABLE member_questions DROP CONSTRAINT IF EXISTS member_questions_content_type_check;
ALTER TABLE member_questions ADD CONSTRAINT member_questions_content_type_check CHECK (content_type IN ('question', 'article'));

CREATE TABLE IF NOT EXISTS question_comments (
  id BIGSERIAL PRIMARY KEY,
  question_id BIGINT NOT NULL REFERENCES member_questions(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ballots (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  ballot_type TEXT NOT NULL CHECK (ballot_type IN ('issue', 'election')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed', 'archived')),
  question_id BIGINT REFERENCES member_questions(id) ON DELETE SET NULL,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ballots DROP CONSTRAINT IF EXISTS ballots_status_check;
ALTER TABLE ballots ADD CONSTRAINT ballots_status_check CHECK (status IN ('draft', 'open', 'closed', 'archived'));

CREATE TABLE IF NOT EXISTS ballot_options (
  id BIGSERIAL PRIMARY KEY,
  ballot_id BIGINT NOT NULL REFERENCES ballots(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  description TEXT DEFAULT '',
  candidate_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS votes (
  id BIGSERIAL PRIMARY KEY,
  ballot_id BIGINT NOT NULL REFERENCES ballots(id) ON DELETE CASCADE,
  option_id BIGINT NOT NULL REFERENCES ballot_options(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ballot_id, user_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('dues', 'donation', 'registration_fee')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  method TEXT NOT NULL DEFAULT 'offline',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'received', 'cancelled')),
  note TEXT DEFAULT '',
  external_reference TEXT DEFAULT '',
  reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_purpose_check;
ALTER TABLE payments ADD CONSTRAINT payments_purpose_check CHECK (purpose IN ('dues', 'donation', 'registration_fee'));

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'announcement',
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  link TEXT DEFAULT '',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_announcements_status_published ON announcements(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_starts_at ON events(starts_at);
CREATE INDEX IF NOT EXISTS idx_questions_status_created ON member_questions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ballots_status_created ON ballots(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_votes_ballot_option ON votes(ballot_id, option_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_created ON payments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_membership_status ON users(membership_status);
