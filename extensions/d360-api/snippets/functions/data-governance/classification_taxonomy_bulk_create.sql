/**
 * Create several classification taxonomies in one request.
 *
 * Check `has_errors` and each `results[].statusCode`, since single items can fail.
 */

call cdp.classification_taxonomy_bulk_create (
    taxonomies => [
        (
            name = 'Compliance_Classifications',
            label = 'Compliance Classifications',
            description = 'Sensitivity classifications.'
        ),
        (
            name = 'Data_Residency_Classifications',
            label = 'Data Residency Classifications',
            description = 'Region-of-origin classifications.'
        )
    ]
);

call cdp.classification_taxonomy_list (search_string => 'Classifications');
