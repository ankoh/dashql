/**
 * Step 1 of Document AI. `:file_id` is a Salesforce file that you uploaded.
 *
 * Read the global configuration, with the models to choose from.
 */

CALL cdp.document_ai_global_configuration_get ();
