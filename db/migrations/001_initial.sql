CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  address text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id),
  username text NOT NULL,
  role text NOT NULL CHECK (role IN ('staff', 'admin')),
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, username)
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, name)
);

CREATE TABLE IF NOT EXISTS tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, name)
);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id),
  category_id uuid REFERENCES categories(id),
  name text NOT NULL,
  price numeric(12, 2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  tone text NOT NULL DEFAULT 'ink',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_tags (
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags(id),
  PRIMARY KEY (product_id, tag_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id),
  order_number text NOT NULL,
  table_number text NOT NULL DEFAULT '',
  service_type text NOT NULL DEFAULT 'Tai cho',
  subtotal numeric(12, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  deposit numeric(12, 2) NOT NULL DEFAULT 0 CHECK (deposit >= 0),
  total numeric(12, 2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  remaining numeric(12, 2) NOT NULL DEFAULT 0 CHECK (remaining >= 0),
  note text NOT NULL DEFAULT '',
  payment_method text CHECK (payment_method IN ('TM', 'CK')),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'PAID')),
  created_by_username text NOT NULL,
  updated_by_username text NOT NULL,
  paid_by_username text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, order_number)
);

CREATE INDEX IF NOT EXISTS orders_store_created_idx
  ON orders(store_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS orders_store_updated_idx
  ON orders(store_id, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS orders_open_idx
  ON orders(store_id, status, updated_at DESC)
  WHERE status = 'OPEN';

CREATE INDEX IF NOT EXISTS orders_archive_candidates_idx
  ON orders(status, updated_at, id)
  WHERE status = 'PAID';

CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  product_id uuid,
  product_name text NOT NULL,
  unit_price numeric(12, 2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  quantity integer NOT NULL CHECK (quantity > 0),
  line_total numeric(12, 2) NOT NULL DEFAULT 0 CHECK (line_total >= 0),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, line_no)
);

CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id, line_no);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  username text NOT NULL,
  role text NOT NULL CHECK (role IN ('staff', 'admin')),
  action text NOT NULL,
  target text NOT NULL DEFAULT '',
  detail text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS audit_logs_store_created_idx
  ON audit_logs(store_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS archive_batches (
  id uuid PRIMARY KEY,
  source_name text NOT NULL,
  store_id uuid NOT NULL,
  range_start timestamptz,
  range_end timestamptz,
  order_count integer NOT NULL DEFAULT 0,
  item_count integer NOT NULL DEFAULT 0,
  audit_count integer NOT NULL DEFAULT 0,
  checksum text NOT NULL,
  status text NOT NULL CHECK (status IN ('COMPLETED', 'FAILED')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS archive_batches_created_idx ON archive_batches(created_at DESC);

CREATE TABLE IF NOT EXISTS cold_archive_manifests (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  file_path text NOT NULL,
  order_count integer NOT NULL DEFAULT 0,
  item_count integer NOT NULL DEFAULT 0,
  audit_count integer NOT NULL DEFAULT 0,
  uncompressed_bytes bigint NOT NULL DEFAULT 0,
  compressed_bytes bigint NOT NULL DEFAULT 0,
  checksum text NOT NULL,
  compressed_at timestamptz NOT NULL DEFAULT now(),
  source_deleted_at timestamptz,
  UNIQUE (store_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS cold_archive_period_idx
  ON cold_archive_manifests(store_id, period_start DESC);
