/**
 * Change the label, description or compute size of a deployment.
 *
 * It doesn't replace the uploaded code, no source shows that. Here the compute size is `Cpu_s`: on update the values are spelled `Cpu_xs` to `Cpu_l`, while create takes `CPU_XS` to `CPU_L`.
 */

call cdp.custom_code_deployment_update (
    custom_code_name_or_id => 'account_rollup',
    label => 'Account rollup nightly',
    compute_type => 'Cpu_s',
    description => 'Nightly account rollup'
);

call cdp.custom_code_deployment_get (custom_code_name_or_id => 'account_rollup');
