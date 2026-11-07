/**
 * Step 1 of Document AI. `:file_id` is a Salesforce file that you uploaded.
 *
 * Read the global configuration, with the models to choose from.
 */

call cdp.document_ai_global_configuration_get ();
