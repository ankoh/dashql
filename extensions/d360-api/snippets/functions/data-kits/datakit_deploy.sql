/**
 * Deploy selected components of an installed kit in the target org.
 *
 * `async_mode` has to be `true`. The shape of `config` depends on the component `type`. The job takes 25 to 45 minutes in Salesforce's sample kits, so keep the `job_id` from the result and poll it with `datakit_deploy_status`. Redeploying overwrites changes made to the deployed components.
 */

call cdp.datakit_deploy (
    data_kit_dev_name => 'Customer_Kit',
    async_mode => true,
    dataspace => 'default',
    components => [
        (
            type = 'DataLakeObject',
            config = (
                data_source_object_dev_name = 'Namespace__Customer',
                api_name = 'Customer',
                label = 'Customer',
                dataspace_name = 'default'
            )
        ),
        (
            type = 'CalculatedInsight',
            config = (
                api_name = 'Namespace__Revenue',
                api_name_override = 'Revenue',
                label = 'Revenue',
                publish_interval = 'NotScheduled'
            )
        )
    ]
);

call cdp.datakit_deploy_status (job_id => '08Paj00000tPyr4');
