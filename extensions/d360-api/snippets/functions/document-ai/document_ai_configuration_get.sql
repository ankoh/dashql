/**
 * Read one Document AI configuration with its schema, model, file types and sync status.
 *
 * The spec's examples vary in case: `status` is `SYNCED` or `Synced`, `activation_status` is `ACTIVATED` or `Activated`. After a batch run, `runtime_status` and `last_run_on` show how it went.
 */

call cdp.document_ai_configuration_list (activation_status => 'Activated', search => 'Invoice', limit => 25);

call cdp.document_ai_configuration_get (id_or_api_name => 'Vendor_Invoice');
