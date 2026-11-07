/**
 * Find out which of several saved schemas fits a document best, for instance to route invoices and receipts.
 *
 * Pass all four body options: the spec gives no default for `mode`. A schema scoring under `threshold` isn't returned, so zero rows can mean no match and not a failure. Only PDF and images work here. `schema_configurations` takes the names of configurations, as the examples do.
 */

call cdp.document_ai_schema_detect (
    schema_configurations => ['Invoice_Schema_v1', 'Receipt_Schema_v2'],
    ml_model => 'llmgateway__VertexAIGemini25Flash001',
    files => [(file_id = '068Hn00000AbCdEIAV', mime_type = 'application/pdf')],
    mode => 'Single',
    threshold => 0.9
);
