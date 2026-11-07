/**
 * Step 2 of custom code.
 *
 * After the upload, repeat until `deployment_status` is `Deployed`.
 */

CALL cdp.custom_code_deployment_get (custom_code_name_or_id => 'account_rollup');
