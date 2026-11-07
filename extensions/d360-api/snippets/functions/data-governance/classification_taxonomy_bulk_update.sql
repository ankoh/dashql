/**
 * Relabel or describe several classification taxonomies in one request.
 *
 * Each item names its taxonomy and sends only what changes, the rest stays.
 */

call cdp.classification_taxonomy_bulk_update (
    items => [
        (name = 'Compliance_Classifications', label = 'Compliance Classifications (GA)'),
        (name = 'Data_Residency_Classifications', description = 'Data residency and sovereignty classifications.')
    ]
);

call cdp.classification_taxonomy_list (search_string => 'Classifications');
