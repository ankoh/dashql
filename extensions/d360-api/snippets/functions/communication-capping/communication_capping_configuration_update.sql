/**
 * Rename a capping configuration, change its description and link it to a second data space.
 *
 * The body has its own `id`, so the path id is `id` and the instance id is `body_id`. The sources don't say whether the arrays replace the existing entries or add to them, so read the configuration afterwards.
 */

call cdp.communication_capping_configuration_update (
    id => '1CCxx0000004C92AAE',
    name => 'Marketing caps 2026',
    description => 'Caps for all marketing sends',
    data_comm_cap_dataspaces => [(dataspace_id = '0vhxx0000000001AAA'), (dataspace_id = '0vhxx0000000002AAA')]
);

call cdp.communication_capping_configuration_get (id => '1CCxx0000004C92AAE');
