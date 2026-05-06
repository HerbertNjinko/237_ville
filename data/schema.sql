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

CREATE TABLE IF NOT EXISTS organization_about (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  summary TEXT NOT NULL DEFAULT '',
  mission_statement TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL DEFAULT '',
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE organization_about ADD COLUMN IF NOT EXISTS mission_statement TEXT NOT NULL DEFAULT '';

INSERT INTO organization_about (id, summary, mission_statement, purpose)
VALUES (
  1,
  '237 Ville is a community organization focused on keeping members informed, connected, and involved.',
  'Our mission is to build a connected, transparent, and active community where members can participate in decisions and support one another.',
  'Our purpose is to support community participation, transparent leadership, member engagement, and shared decision-making.'
)
ON CONFLICT (id) DO NOTHING;

UPDATE organization_about
SET mission_statement = 'Our mission is to build a connected, transparent, and active community where members can participate in decisions and support one another.'
WHERE mission_statement = '';

CREATE TABLE IF NOT EXISTS leadership_positions (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  holder_name TEXT NOT NULL DEFAULT '',
  body TEXT DEFAULT '',
  image_name TEXT DEFAULT '',
  image_type TEXT DEFAULT '',
  image_size INTEGER DEFAULT 0,
  image_data_url TEXT DEFAULT '',
  display_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden', 'archived')),
  archived_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE leadership_positions ADD COLUMN IF NOT EXISTS holder_name TEXT NOT NULL DEFAULT '';
ALTER TABLE leadership_positions ADD COLUMN IF NOT EXISTS body TEXT DEFAULT '';
ALTER TABLE leadership_positions ADD COLUMN IF NOT EXISTS image_name TEXT DEFAULT '';
ALTER TABLE leadership_positions ADD COLUMN IF NOT EXISTS image_type TEXT DEFAULT '';
ALTER TABLE leadership_positions ADD COLUMN IF NOT EXISTS image_size INTEGER DEFAULT 0;
ALTER TABLE leadership_positions ADD COLUMN IF NOT EXISTS image_data_url TEXT DEFAULT '';
ALTER TABLE leadership_positions ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE leadership_positions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published';
ALTER TABLE leadership_positions ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE leadership_positions DROP CONSTRAINT IF EXISTS leadership_positions_status_check;
ALTER TABLE leadership_positions ADD CONSTRAINT leadership_positions_status_check CHECK (status IN ('published', 'hidden', 'archived'));
UPDATE leadership_positions
SET archived_at = COALESCE(archived_at, updated_at, created_at)
WHERE status = 'archived' AND archived_at IS NULL;

CREATE TABLE IF NOT EXISTS public_about_articles (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  image_name TEXT DEFAULT '',
  image_type TEXT DEFAULT '',
  image_size INTEGER DEFAULT 0,
  image_data_url TEXT DEFAULT '',
  display_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden')),
  hidden_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public_about_articles ADD COLUMN IF NOT EXISTS image_name TEXT DEFAULT '';
ALTER TABLE public_about_articles ADD COLUMN IF NOT EXISTS image_type TEXT DEFAULT '';
ALTER TABLE public_about_articles ADD COLUMN IF NOT EXISTS image_size INTEGER DEFAULT 0;
ALTER TABLE public_about_articles ADD COLUMN IF NOT EXISTS image_data_url TEXT DEFAULT '';
ALTER TABLE public_about_articles ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public_about_articles ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published';
ALTER TABLE public_about_articles ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;
ALTER TABLE public_about_articles DROP CONSTRAINT IF EXISTS public_about_articles_status_check;
ALTER TABLE public_about_articles ADD CONSTRAINT public_about_articles_status_check CHECK (status IN ('published', 'hidden'));
UPDATE public_about_articles
SET hidden_at = COALESCE(hidden_at, updated_at, created_at)
WHERE status = 'hidden' AND hidden_at IS NULL;

CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  location TEXT DEFAULT '',
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  archived_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE events ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE events ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_status_check;
ALTER TABLE events ADD CONSTRAINT events_status_check CHECK (status IN ('active', 'archived'));

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
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('dues', 'donation', 'registration_fee')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  method TEXT NOT NULL DEFAULT 'offline',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'received', 'cancelled')),
  note TEXT DEFAULT '',
  external_reference TEXT DEFAULT '',
  donor_name TEXT DEFAULT '',
  donor_email TEXT DEFAULT '',
  dwolla_transfer_url TEXT DEFAULT '',
  processor_status TEXT DEFAULT '',
  published_at TIMESTAMPTZ,
  payment_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  payment_detail_snapshot TEXT DEFAULT '',
  reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE payments ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS donor_name TEXT DEFAULT '';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS donor_email TEXT DEFAULT '';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS dwolla_transfer_url TEXT DEFAULT '';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS processor_status TEXT DEFAULT '';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_details JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_detail_snapshot TEXT DEFAULT '';
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_purpose_check;
ALTER TABLE payments ADD CONSTRAINT payments_purpose_check CHECK (purpose IN ('dues', 'donation', 'registration_fee'));

CREATE TABLE IF NOT EXISTS organization_payment_details (
  method TEXT PRIMARY KEY CHECK (method IN ('cash', 'cash_app', 'venmo', 'zelle', 'paypal', 'cheque', 'bank_account')),
  display_name TEXT NOT NULL,
  account_identifier TEXT DEFAULT '',
  instructions TEXT DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE organization_payment_details ADD COLUMN IF NOT EXISTS account_identifier TEXT DEFAULT '';
ALTER TABLE organization_payment_details ADD COLUMN IF NOT EXISTS instructions TEXT DEFAULT '';
ALTER TABLE organization_payment_details ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE organization_payment_details ADD COLUMN IF NOT EXISTS updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE organization_payment_details DROP CONSTRAINT IF EXISTS organization_payment_details_method_check;
ALTER TABLE organization_payment_details ADD CONSTRAINT organization_payment_details_method_check CHECK (method IN ('cash', 'cash_app', 'venmo', 'zelle', 'paypal', 'cheque', 'bank_account'));

INSERT INTO organization_payment_details (method, display_name, account_identifier, instructions, enabled)
VALUES
  ('cash', 'Cash', '', 'Enter the donor name and the person who received the cash.', TRUE),
  ('cash_app', 'Cash App', '', '', TRUE),
  ('venmo', 'Venmo', '', '', TRUE),
  ('zelle', 'Zelle', '', '', TRUE),
  ('paypal', 'PayPal', '', '', TRUE),
  ('cheque', 'Cheque', '', 'Make cheques payable to 237 Ville and enter the cheque number or reference below.', TRUE),
  ('bank_account', 'Bank account', '', 'Pay directly to the 237 Ville bank account using the account details configured here. Enter your bank details below for admin review.', TRUE)
ON CONFLICT (method) DO NOTHING;

UPDATE organization_payment_details
SET display_name = 'Bank account',
    instructions = CASE
      WHEN COALESCE(instructions, '') = '' THEN 'Pay directly to the 237 Ville bank account using the account details configured here. Enter your bank details below for admin review.'
      ELSE instructions
    END,
    updated_at = now()
WHERE method = 'bank_account'
  AND display_name = 'Bank account / ACH review';

CREATE TABLE IF NOT EXISTS expenditures (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT DEFAULT '',
  vendor TEXT DEFAULT '',
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE expenditures ADD COLUMN IF NOT EXISTS category TEXT DEFAULT '';
ALTER TABLE expenditures ADD COLUMN IF NOT EXISTS vendor TEXT DEFAULT '';
ALTER TABLE expenditures ADD COLUMN IF NOT EXISTS expense_date DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE expenditures ADD COLUMN IF NOT EXISTS note TEXT DEFAULT '';
ALTER TABLE expenditures ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE expenditures ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE expenditures DROP CONSTRAINT IF EXISTS expenditures_status_check;
ALTER TABLE expenditures ADD CONSTRAINT expenditures_status_check CHECK (status IN ('draft', 'published'));

CREATE TABLE IF NOT EXISTS social_meetings (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  meeting_date DATE NOT NULL UNIQUE,
  location TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'completed', 'cancelled')),
  announcement_id BIGINT REFERENCES announcements(id) ON DELETE SET NULL,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE social_meetings ADD COLUMN IF NOT EXISTS location TEXT DEFAULT '';
ALTER TABLE social_meetings ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';
ALTER TABLE social_meetings ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE social_meetings ADD COLUMN IF NOT EXISTS announcement_id BIGINT REFERENCES announcements(id) ON DELETE SET NULL;
ALTER TABLE social_meetings ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE social_meetings DROP CONSTRAINT IF EXISTS social_meetings_status_check;
ALTER TABLE social_meetings ADD CONSTRAINT social_meetings_status_check CHECK (status IN ('draft', 'published', 'completed', 'cancelled'));

CREATE TABLE IF NOT EXISTS social_assignments (
  id BIGSERIAL PRIMARY KEY,
  meeting_id BIGINT NOT NULL REFERENCES social_meetings(id) ON DELETE CASCADE,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  task_type TEXT NOT NULL DEFAULT 'other' CHECK (task_type IN ('food', 'drinks', 'host', 'setup', 'cleanup', 'other')),
  group_name TEXT NOT NULL DEFAULT 'general',
  title TEXT NOT NULL,
  note TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE social_assignments ADD COLUMN IF NOT EXISTS group_name TEXT NOT NULL DEFAULT 'general';
ALTER TABLE social_assignments ADD COLUMN IF NOT EXISTS note TEXT DEFAULT '';
ALTER TABLE social_assignments ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'assigned';
ALTER TABLE social_assignments ADD COLUMN IF NOT EXISTS food_contribution TEXT DEFAULT '';
ALTER TABLE social_assignments ADD COLUMN IF NOT EXISTS drink_bottle_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE social_assignments ADD COLUMN IF NOT EXISTS drink_is_alcoholic BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE social_assignments ADD COLUMN IF NOT EXISTS drink_brand TEXT DEFAULT '';
ALTER TABLE social_assignments ADD COLUMN IF NOT EXISTS response_note TEXT DEFAULT '';
ALTER TABLE social_assignments ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ;
ALTER TABLE social_assignments DROP CONSTRAINT IF EXISTS social_assignments_task_type_check;
ALTER TABLE social_assignments ADD CONSTRAINT social_assignments_task_type_check CHECK (task_type IN ('food', 'drinks', 'host', 'setup', 'cleanup', 'other'));
ALTER TABLE social_assignments DROP CONSTRAINT IF EXISTS social_assignments_status_check;
ALTER TABLE social_assignments ADD CONSTRAINT social_assignments_status_check CHECK (status IN ('assigned', 'completed', 'cancelled'));
ALTER TABLE social_assignments DROP CONSTRAINT IF EXISTS social_assignments_drink_bottle_count_check;
ALTER TABLE social_assignments ADD CONSTRAINT social_assignments_drink_bottle_count_check CHECK (drink_bottle_count >= 0);

CREATE TABLE IF NOT EXISTS social_resources (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  total_quantity INTEGER NOT NULL DEFAULT 0 CHECK (total_quantity >= 0),
  available_quantity INTEGER NOT NULL DEFAULT 0 CHECK (available_quantity >= 0),
  storage_location TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE social_resources ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
ALTER TABLE social_resources ADD COLUMN IF NOT EXISTS total_quantity INTEGER NOT NULL DEFAULT 0;
ALTER TABLE social_resources ADD COLUMN IF NOT EXISTS available_quantity INTEGER NOT NULL DEFAULT 0;
ALTER TABLE social_resources ADD COLUMN IF NOT EXISTS storage_location TEXT DEFAULT '';
ALTER TABLE social_resources ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE social_resources ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE social_resources DROP CONSTRAINT IF EXISTS social_resources_total_quantity_check;
ALTER TABLE social_resources ADD CONSTRAINT social_resources_total_quantity_check CHECK (total_quantity >= 0);
ALTER TABLE social_resources DROP CONSTRAINT IF EXISTS social_resources_available_quantity_check;
ALTER TABLE social_resources ADD CONSTRAINT social_resources_available_quantity_check CHECK (available_quantity >= 0);
ALTER TABLE social_resources DROP CONSTRAINT IF EXISTS social_resources_status_check;
ALTER TABLE social_resources ADD CONSTRAINT social_resources_status_check CHECK (status IN ('active', 'retired'));

INSERT INTO social_resources (name, description, total_quantity, available_quantity, storage_location, status)
SELECT 'Chairs', 'Organization chairs available for member-hosted meetings.', 0, 0, '', 'active'
WHERE NOT EXISTS (SELECT 1 FROM social_resources WHERE lower(name) = 'chairs');

CREATE TABLE IF NOT EXISTS social_resource_requests (
  id BIGSERIAL PRIMARY KEY,
  meeting_id BIGINT REFERENCES social_meetings(id) ON DELETE SET NULL,
  resource_id BIGINT NOT NULL REFERENCES social_resources(id) ON DELETE CASCADE,
  requested_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  needed_date DATE,
  return_date DATE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'returned')),
  note TEXT DEFAULT '',
  admin_note TEXT DEFAULT '',
  reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE social_resource_requests ADD COLUMN IF NOT EXISTS meeting_id BIGINT REFERENCES social_meetings(id) ON DELETE SET NULL;
ALTER TABLE social_resource_requests ADD COLUMN IF NOT EXISTS needed_date DATE;
ALTER TABLE social_resource_requests ADD COLUMN IF NOT EXISTS return_date DATE;
ALTER TABLE social_resource_requests ADD COLUMN IF NOT EXISTS note TEXT DEFAULT '';
ALTER TABLE social_resource_requests ADD COLUMN IF NOT EXISTS admin_note TEXT DEFAULT '';
ALTER TABLE social_resource_requests ADD COLUMN IF NOT EXISTS reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE social_resource_requests ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE social_resource_requests DROP CONSTRAINT IF EXISTS social_resource_requests_quantity_check;
ALTER TABLE social_resource_requests ADD CONSTRAINT social_resource_requests_quantity_check CHECK (quantity > 0);
ALTER TABLE social_resource_requests DROP CONSTRAINT IF EXISTS social_resource_requests_status_check;
ALTER TABLE social_resource_requests ADD CONSTRAINT social_resource_requests_status_check CHECK (status IN ('pending', 'approved', 'declined', 'returned'));

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
CREATE INDEX IF NOT EXISTS idx_leadership_status_order ON leadership_positions(status, display_order, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_about_articles_status_order ON public_about_articles(status, display_order, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_about_articles_hidden_at ON public_about_articles(hidden_at) WHERE status = 'hidden';
CREATE INDEX IF NOT EXISTS idx_events_starts_at ON events(starts_at);
CREATE INDEX IF NOT EXISTS idx_questions_status_created ON member_questions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ballots_status_created ON ballots(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_votes_ballot_option ON votes(ballot_id, option_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_created ON payments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_published ON payments(purpose, status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_expenditures_status_date ON expenditures(status, expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_social_meetings_date ON social_meetings(meeting_date DESC);
CREATE INDEX IF NOT EXISTS idx_social_assignments_meeting ON social_assignments(meeting_id);
CREATE INDEX IF NOT EXISTS idx_social_assignments_user ON social_assignments(user_id, status);
CREATE INDEX IF NOT EXISTS idx_social_resources_status ON social_resources(status, name);
CREATE INDEX IF NOT EXISTS idx_social_resource_requests_user ON social_resource_requests(requested_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_resource_requests_status ON social_resource_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_membership_status ON users(membership_status);
