/**
 * Delete the configuration Notebook AI keeps for a data space. Read it first.
 *
 * Without a configuration, `knowledge_space_create` fails with `No Knowledge Space Config Found For the DataSpace`.
 */

call cdp.knowledge_space_configuration_get (knowledge_space_config_api_name_or_id => 'Default_Config');

call cdp.knowledge_space_configuration_delete (knowledge_space_config_api_name_or_id => 'Default_Config');
