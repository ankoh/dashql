/**
 * Build a kit in the source org from a bundle of CRM streams.
 *
 * The kit holds metadata, not data. Creating it deploys nothing: it still has to reach the target org in a package. `data_kit_type` takes `None` or `Sandbox` and is effectively required, and `components` may be empty on a first create.
 */

call cdp.datakit_create (
    data_kit_dev_name => 'NewDataKit',
    label => 'New Data Kit From API',
    data_kit_type => 'None',
    dataspace_name => 'default',
    components => [
        (
            type = 'DataStreamBundle',
            info = (
                name = 'CRMBundle',
                connector_type = 'CRM',
                streams = [
                    (dev_name = 'Lead_Home__dll', label = 'Lead_Home'),
                    (dev_name = 'User_Home__dll', label = 'User_Home')
                ]
            )
        ),
        (type = 'DataLakeObject', info = (name = 'Customer__dll', label = 'Customer'))
    ]
);
