/**
 * Create the Notebook AI configuration of a data space.
 *
 * Sources disagree on whether this is usable: one says an admin has to enable Notebook AI first. The option is `dataspace` here and `dataSpace` on knowledge spaces.
 */

call cdp.knowledge_space_configuration_create (
    developer_name => 'Default_Config',
    label => 'Default Configuration',
    dataspace => 'default'
);

call cdp.knowledge_space_configuration_get (knowledge_space_config_api_name_or_id => 'Default_Config');
