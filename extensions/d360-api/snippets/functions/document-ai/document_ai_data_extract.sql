/**
 * Pull structured data out of one file and get it back as JSON, with nothing stored.
 *
 * Here the schema is passed inline with a model. Alternatively pass `idp_configuration_id_or_name` of a saved configuration, not both. The root `description` of the schema can carry instructions, and `start_page` and `end_page` limit the pages read. With `extract_data_with_confidence_score`, each field gets a score.
 */

call cdp.document_ai_data_extract (
    ml_model => 'llmgateway__VertexAIGemini25Flash001',
    files => [(file_id = '068Hn00000AbCdEIAV', mime_type = 'application/pdf')],
    start_page => 1,
    end_page => 3,
    extract_data_with_confidence_score => true,
    schema_config => $$
    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "title": "Invoice",
      "description": "Ignore the terms and conditions pages.",
      "type": "object",
      "properties": {
        "invoice_number": { "type": "string", "description": "The legal invoice identifier." },
        "invoice_date": { "type": "string", "format": "date" },
        "total": { "type": "number" }
      },
      "required": ["invoice_number"]
    }
  $$
);
