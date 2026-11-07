/**
 * Register a new code deployment and get the URL to upload its zip package to.
 *
 * It only registers: nothing runs until the package is uploaded. Afterwards read the deployment until `deployment_status` is `Deployed`, or `Error` on failure. The name takes letters, digits and underscores, starts with a letter, is unique and has at most 40 characters. `compute_type` is `CPU_XS` to `CPU_L` here.
 */

call cdp.custom_code_deployment_create (
    name => 'account_rollup',
    label => 'Account rollup',
    code_type => 'Script',
    compute_type => 'CPU_XS',
    description => 'Rolls accounts up by region'
);

call cdp.custom_code_deployment_get (custom_code_name_or_id => 'account_rollup');
