/**
 * Search the metadata in plain words and get the matching objects, instead of listing everything. A result's `api_name` is what `metadata` takes as `entity_name`.
 *
 * The search may not work in an org whose search index isn't built. Fall back to the entity list then.
 */

call cdp.metadata_search (
    query => 'customer orders',
    filters => [(field = 'metadata_type', values = ['DataModelObject', 'CalculatedInsight'])],
    pagination => (limit = 10)
);

call cdp.metadata (entity_name => 'ssot__Individual__dlm');
