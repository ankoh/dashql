/**
 * Delete several classification taxonomies in one request, here the ones that are no longer used.
 */

call cdp.classification_taxonomy_list (search_string => 'Classifications');

call cdp.classification_taxonomy_bulk_delete (
    names => ['Compliance_Classifications', 'Data_Residency_Classifications']
);
