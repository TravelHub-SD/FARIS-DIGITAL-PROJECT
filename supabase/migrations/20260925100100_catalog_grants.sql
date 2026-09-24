-- Functions used by generated columns and CHECK constraints are evaluated
-- with the privileges of the role that writes the row. Found in Phase 4:
-- service_role could not insert a product (products.search_text calls
-- private.normalize_ar) because it had no USAGE on `private`.
-- Grant only these pure, side-effect-free functions.
grant usage on schema private to service_role;
grant execute on function private.normalize_ar(text) to service_role;
grant execute on function private.valid_field_definitions(jsonb) to authenticated, service_role;
