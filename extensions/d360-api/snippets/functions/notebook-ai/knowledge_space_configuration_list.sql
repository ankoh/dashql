/**
 * List the Notebook AI configurations, one per data space, with their provisioning status.
 *
 * The spec doesn't list the `provisioning_status` values. This object spells the data space column `dataspace`, knowledge spaces use `dataSpace`.
 */

call cdp.knowledge_space_configuration_list ();

call cdp.knowledge_space_configuration_get (knowledge_space_config_api_name_or_id => 'Default_Config');
