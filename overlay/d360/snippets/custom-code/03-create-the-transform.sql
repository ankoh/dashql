/**
 * Step 3 of custom code.
 *
 * Create a data transform that runs the code.
 */

CALL cdp.transform_create (name => 'account_rollup', label => 'account_rollup', type => 'BATCH', dataspace_name => 'default', definition => $$
  {"type": "DCSQL", "version": "56.0", "manifest": {
    "nodes": {"node1": {"relation_name": "Account_std_copy__dll", "config": {"materialized": "table"}, "compiled_code": ""}},
    "sources": {"source1": {"relation_name": "Account_std__dll"}},
    "macros": {"macro.byoc": {"arguments": [{"name": "account_rollup", "type": "BYOC_SCRIPT"}]}}
  }}
$$);
