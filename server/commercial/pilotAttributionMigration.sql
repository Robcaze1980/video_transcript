ALTER TABLE checkout_orders
  ADD COLUMN IF NOT EXISTS landing_locale text,
  ADD COLUMN IF NOT EXISTS landing_source text CHECK (landing_source IN ('chatgpt', 'unattributed'));

CREATE OR REPLACE VIEW pilot_preview_conversions AS
SELECT (orders.fulfilled_at AT TIME ZONE 'UTC')::date AS conversion_day,
       orders.landing_locale AS locale, orders.landing_source AS source,
       count(*)::int AS conversions
FROM checkout_orders AS orders
JOIN purchases ON purchases.checkout_order_id = orders.id
WHERE orders.fulfilled_at IS NOT NULL AND orders.landing_locale IS NOT NULL
  AND orders.landing_source IS NOT NULL
GROUP BY 1, 2, 3;

CREATE TABLE IF NOT EXISTS pilot_preview_funnel_entries (
  session_id uuid NOT NULL,
  locale text NOT NULL,
  event text NOT NULL CHECK (event IN ('landing_view', 'product_entry')),
  source text NOT NULL CHECK (source IN ('chatgpt', 'unattributed')),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (session_id, locale, event)
);

CREATE OR REPLACE VIEW pilot_preview_funnel AS
SELECT (occurred_at AT TIME ZONE 'UTC')::date AS event_day,
       locale, source, event, count(*)::int AS total
FROM pilot_preview_funnel_entries
GROUP BY 1, 2, 3, 4
UNION ALL
SELECT conversion_day, locale, source, 'purchase_credited', conversions
FROM pilot_preview_conversions;
