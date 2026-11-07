/**
 * Save an extraction setup: a model, the file types it reads and the JSON schema of the fields to extract.
 *
 * Without `source_dmo_developer_name` the configuration serves ad hoc extraction. For batch runs, set it to an unstructured DMO. Read the configuration to see the `status` of its sync, which shows `SYNCED` or `Synced`.
 */

call cdp.document_ai_configuration_create (
    name => 'Vendor_Invoice',
    label => 'Vendor Invoice',
    description => 'Supplier invoices as PDF or image',
    ml_model => 'llmgateway__VertexAIGemini25Flash001',
    activation_status => 'Activated',
    file_config => (file_types = ['application/pdf', 'image/png', 'image/jpeg']),
    schema_config => $$
    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "title": "Vendor Invoice",
      "type": "object",
      "properties": {
        "invoice_number": { "type": "string", "description": "The legal invoice identifier." },
        "total": { "type": "number" }
      }
    }
  $$
);

call cdp.document_ai_configuration_get (id_or_api_name => 'Vendor_Invoice');
