-- Intentionally empty. The payment fulfillment function was defined here, redefined in 003 and is now
-- defined once, in 004_multicurrency_paypal.sql. Keeping this file preserves migration numbering for
-- databases that already applied it (004 uses CREATE OR REPLACE so it is safe in both situations).
select 1;
