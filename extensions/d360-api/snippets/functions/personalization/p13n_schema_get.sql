/**
 * Inspect a schema with its attributes, content object and related objects, before you create points on it.
 *
 * There is no list call for schemas. The second call lists the transformers that were built from this schema.
 */

call cdp.p13n_schema_get (id_or_name => 'product_recommendations_schema');

call cdp.p13n_transformer_list (schema_reference => 'product_recommendations_schema');
