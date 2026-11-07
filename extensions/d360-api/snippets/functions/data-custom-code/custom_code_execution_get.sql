/**
 * Read one run of a deployment, to check its status or error.
 *
 * The run has ended when `status` is `Success`, `Failure` or `Cancelled`. The id is the `id` of a row of the run list. The script's own log lines are in the `DataCustomCodeLogs__dll` DLO, and can take about 10 minutes to appear.
 */

call cdp.custom_code_execution_list (custom_code_name_or_id => 'account_rollup', limit => 20);

call cdp.custom_code_execution_get (
    custom_code_name_or_id => 'account_rollup',
    custom_code_execution_id => '4f1b2c7e-9a3d-4e68-8b15-2d7c0a6e91f3'
);
