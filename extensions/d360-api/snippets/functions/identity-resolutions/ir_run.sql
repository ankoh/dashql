/**
 * Run a ruleset now instead of waiting for its schedule, then read how the run went.
 *
 * Read `result_code` of the answer first: all its values arrive in a successful response, and only one of them starts a run. Then wait until `last_job_status` is `SUCCESS`. `FAIL` and `FAILED` are failures and `SKIPPED` is possible too.
 */

call cdp.ir_run (
    identity_resolution => '1irfj000000IWhWAAW',
    calling_app => 'dashql',
    calling_app_info => 'nightly refresh of the customer match'
);

call cdp.ir_get (identity_resolution => '1irfj000000IWhWAAW');
