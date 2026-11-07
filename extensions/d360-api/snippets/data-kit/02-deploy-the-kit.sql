/**
 * Step 2 of the data kit.
 *
 * In the target org, after installing the package, deploy the kit. The `job_id` in the result is the `:job_id` of the next step.
 */

call cdp.datakit_deploy (data_kit_dev_name => 'Customer_Kit', async_mode => true, components => []);
