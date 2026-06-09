-- Task 2: Analytics materialized views
-- Run in Supabase SQL Editor after Task 1 migrations are applied.

-- Materialized View 1: top searched drugs
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_drug_search_analytics AS
SELECT
  resolved_ingredient,
  COUNT(*) AS search_count,
  COUNT(DISTINCT user_id) AS unique_searchers
FROM search_logs
WHERE resolved_ingredient IS NOT NULL
GROUP BY resolved_ingredient
ORDER BY search_count DESC;

-- Materialized View 2: top purchased drugs
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_drug_purchase_analytics AS
SELECT
  d.id AS drug_id,
  d.brand_name,
  d.brand_name_ar,
  d.active_ingredient,
  SUM(r.quantity) AS total_purchased,
  COUNT(r.id) AS total_orders
FROM reservations r
JOIN inventory i ON r.inventory_id = i.id
JOIN drugs d ON i.drug_id = d.id
WHERE r.status = 'confirmed'
GROUP BY d.id, d.brand_name, d.brand_name_ar, d.active_ingredient
ORDER BY total_purchased DESC;

-- Unique indexes required for REFRESH MATERIALIZED VIEW CONCURRENTLY
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_drug_search_analytics_ingredient
  ON mv_drug_search_analytics (resolved_ingredient);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_drug_purchase_analytics_drug_id
  ON mv_drug_purchase_analytics (drug_id);

-- Grant service_role access (PostgREST reads via adminClient)
GRANT SELECT ON mv_drug_search_analytics TO service_role;
GRANT SELECT ON mv_drug_purchase_analytics TO service_role;

-- pg_cron hourly refresh (requires pg_cron extension enabled in Supabase)
-- Run once manually after creating views:
-- REFRESH MATERIALIZED VIEW CONCURRENTLY mv_drug_search_analytics;
-- REFRESH MATERIALIZED VIEW CONCURRENTLY mv_drug_purchase_analytics;

SELECT cron.schedule(
  'refresh-analytics-hourly',
  '0 * * * *',
  $$
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_drug_search_analytics;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_drug_purchase_analytics;
  $$
);
