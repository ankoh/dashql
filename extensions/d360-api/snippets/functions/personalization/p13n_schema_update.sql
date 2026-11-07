/**
 * Relabel a schema and give it a new attribute.
 *
 * Points that use the schema may be affected. No source says whether `attributes` is added to the existing list or replaces it, so read the schema afterwards.
 */

call cdp.p13n_schema_update (
    id_or_name => 'product_recommendations_schema',
    label => 'Updated Product Recommendations',
    description => 'Recommendations for the product pages',
    attributes => [(name = 'new_attribute', label = 'New Attribute', default_value = 'default_value')]
);

call cdp.p13n_schema_get (id_or_name => 'product_recommendations_schema');
