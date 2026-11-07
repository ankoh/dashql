/**
 * Permanently remove a custom code deployment that nothing depends on any more.
 *
 * It can't be undone. Remove or disable everything that references the code first, such as transforms and search indexes. Deleting takes a few minutes: the deployment is gone when it no longer shows in the list.
 */

call cdp.custom_code_deployment_get (custom_code_name_or_id => 'account_rollup');

call cdp.custom_code_deployment_delete (custom_code_name_or_id => 'account_rollup');
