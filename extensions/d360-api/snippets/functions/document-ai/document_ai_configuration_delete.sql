/**
 * Delete a Document AI configuration that isn't used any more.
 *
 * Read it first to see what you delete. The sources don't say whether the DLOs in `extracted_dlos` go with it, so check them afterwards. Extract calls that still name the configuration should fail.
 */

call cdp.document_ai_configuration_get (id_or_api_name => 'Vendor_Invoice');

call cdp.document_ai_configuration_delete (id_or_api_name => 'Vendor_Invoice');
