-- Migration 003: Inventory upsert constraints
-- Purpose: prevent duplicate inventory rows when the same Excel is uploaded multiple times.
--
-- Logic:
--   same drug_id + pharmacy_id + batch_number (non-null) → one row (upsert updates it)
--   same drug_id + pharmacy_id + batch_number = null     → one row  (partial index)
--   same drug_id + pharmacy_id + different batch_number  → separate rows (intentional)
--
-- Run in Supabase SQL Editor after migration 002.

-- 1. Unique constraint for rows that have a batch_number
ALTER TABLE inventory
  ADD CONSTRAINT unique_drug_pharmacy_batch
  UNIQUE (drug_id, pharmacy_id, batch_number);

-- 2. Partial unique index for rows where batch_number IS NULL
--    (PostgreSQL treats NULL != NULL in UNIQUE constraints, so we need this separately)
CREATE UNIQUE INDEX unique_drug_pharmacy_no_batch
  ON inventory (drug_id, pharmacy_id)
  WHERE batch_number IS NULL;
