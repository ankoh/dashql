/**
 * Read one Notebook AI configuration, to check how it is provisioned for a data space.
 */

call d360.knowledge_space_configuration_list ();

call d360.knowledge_space_configuration_get (knowledge_space_config_api_name_or_id => 'Default_Config');
