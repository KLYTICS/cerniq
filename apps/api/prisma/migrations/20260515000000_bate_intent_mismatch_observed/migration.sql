-- ADR-0017: BATE INTENT_MISMATCH_OBSERVED signal type
--
-- Pure additive: appends one value to the BateSignalType enum.
-- Postgres ALTER TYPE ADD VALUE is non-destructive and forward-compat —
-- existing rows are unaffected; downstream code that doesn't know about
-- INTENT_MISMATCH_OBSERVED reads the value as a string when it appears.
--
-- Safe to run online (Postgres documents ADD VALUE as non-blocking
-- except for the brief ACCESS EXCLUSIVE on pg_enum). No backfill needed
-- (no existing rows can have this value).
--
-- CLAUDE.md invariant #6 — denial precedence is unchanged; this signal
-- feeds the BATE trust score, which feeds the existing
-- TRUST_SCORE_TOO_LOW denial path (no new wire-level surface).

ALTER TYPE "BateSignalType" ADD VALUE 'INTENT_MISMATCH_OBSERVED';
