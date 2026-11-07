/**
 * Step 3 of Document AI. `:file_id` is a Salesforce file that you uploaded.
 *
 * Extract the data of `:file_id` with a configuration that uses the schema.
 */

CALL cdp.document_ai_data_extract (idp_configuration_id_or_name => 'Vendor_Invoice', files => [(file_id = :file_id)]);
