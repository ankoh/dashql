/**
 * List the code deployments of the org, here the scripts that failed, most recently deployed first.
 *
 * `code_type` is `Script` for code that runs in a data transform and `Function` for code in a search index. `Deployed` means ready and `Error` means failed. `order_by` takes values such as `DeployedOnDesc` and `NameAsc`.
 */

call cdp.custom_code_deployment_list (
    code_type => 'Script',
    deployment_status => 'Error',
    order_by => 'DeployedOnDesc',
    limit => 50,
    offset => 0
);

call cdp.custom_code_deployment_get (custom_code_name_or_id => 'account_rollup');
