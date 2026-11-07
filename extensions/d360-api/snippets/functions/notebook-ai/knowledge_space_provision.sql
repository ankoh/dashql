/**
 * Provision knowledge spaces for data spaces. No source explains how it relates to enabling Notebook AI, which is an admin step.
 *
 * The result is only `success`. The provisioning status of each data space is in `knowledge_space_configuration_list`.
 */

call cdp.knowledge_space_provision (dataspaces => ['default', 'analytics']);

call cdp.knowledge_space_configuration_list ();
