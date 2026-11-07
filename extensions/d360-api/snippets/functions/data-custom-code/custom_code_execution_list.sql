/**
 * List the runs of a deployment with their status, row counts and timings.
 *
 * Rows appear only after something runs the code, such as a transform run, so a new deployment has none. The script's log lines are not in this result.
 */

call cdp.custom_code_execution_list (custom_code_name_or_id => 'account_rollup', limit => 20, offset => 0);

call cdp.custom_code_execution_get (
    custom_code_name_or_id => 'account_rollup',
    custom_code_execution_id => '4f1b2c7e-9a3d-4e68-8b15-2d7c0a6e91f3'
);
