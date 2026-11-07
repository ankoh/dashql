/**
 * Read one ruleset with its match and reconciliation rules and the state of its last run.
 *
 * Wait on `last_job_status`: it tells whether the current run finished. Treat `FAIL` and `FAILED` as failures. Find the `id` in the list.
 */

call cdp.ir_list ();

call cdp.ir_get (identity_resolution => '1irfj000000IWhWAAW');
