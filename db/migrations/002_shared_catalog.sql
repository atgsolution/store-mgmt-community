ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS receipt_font_size integer NOT NULL DEFAULT 14;

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS receipt_footer text NOT NULL DEFAULT 'Thank you';

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

ALTER TABLE stores
  DROP CONSTRAINT IF EXISTS stores_receipt_font_size_check;

ALTER TABLE stores
  ADD CONSTRAINT stores_receipt_font_size_check
  CHECK (receipt_font_size BETWEEN 10 AND 24);

CREATE INDEX IF NOT EXISTS categories_store_sort_idx
  ON categories(store_id, sort_order, id);

CREATE INDEX IF NOT EXISTS tags_store_active_idx
  ON tags(store_id, active, name);

CREATE INDEX IF NOT EXISTS products_store_active_idx
  ON products(store_id, active, category_id, name);

CREATE INDEX IF NOT EXISTS product_tags_tag_idx
  ON product_tags(tag_id, product_id);
