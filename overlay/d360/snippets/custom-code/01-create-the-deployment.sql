/**
 * Step 1 of custom code.
 *
 * Create the deployment. Its `file_upload_url` is where `deployment.zip` goes, outside DashQL.
 */

call cdp.custom_code_deployment_create (
    name => 'account_rollup',
    label => 'Account rollup',
    code_type => 'Script',
    compute_type => 'CPU_XS'
);
