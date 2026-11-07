/**
 * Read one deployment by name or id, to see whether its deployment finished after the upload.
 *
 * Poll `deployment_status`, not `status`. Only two values have a documented meaning: `Deployed` is ready and `Error` is failed. Keep polling through `Pending`, `Scanning` and `Initializing`.
 */

call cdp.custom_code_deployment_list (code_type => 'Script', limit => 50);

call cdp.custom_code_deployment_get (custom_code_name_or_id => 'account_rollup');
