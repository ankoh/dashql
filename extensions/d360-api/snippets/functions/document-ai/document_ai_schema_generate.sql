/**
 * Let a model draft an extraction schema from sample files, instead of writing one by hand.
 *
 * Nothing is saved. Design the schema from a varied set of documents rather than one example. `schema` in the result is a JSON string, and the spec's example wraps it in `{"schema": ...}`, so unwrap it before using it as `schema_config`. Check `error` too, since it comes in the success shape.
 */

call cdp.document_ai_schema_generate (
    ml_model => 'llmgateway__VertexAIGemini25Flash001',
    files => [
        (file_id = '068Hn00000AbCdEIAV', mime_type = 'application/pdf'),
        (file_id = '068Hn00000AbCdFIAV', mime_type = 'application/pdf')
    ]
);
