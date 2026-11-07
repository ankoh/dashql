/**
 * Step 2 of Document AI. `:file_id` is a Salesforce file that you uploaded.
 *
 * Generate a schema from the document `:file_id`.
 */

CALL cdp.document_ai_schema_generate (ml_model => 'llmgateway__VertexAIGemini25Flash001', files => [(file_id = :file_id)]);
