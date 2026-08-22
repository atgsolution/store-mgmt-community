CREATE TABLE IF NOT EXISTS daily_cash_balances (
  business_date date PRIMARY KEY,
  opening_cash numeric(12, 2) NOT NULL DEFAULT 0 CHECK (opening_cash >= 0),
  updated_by_username text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS daily_cash_balances_updated_idx
  ON daily_cash_balances(updated_at DESC);
