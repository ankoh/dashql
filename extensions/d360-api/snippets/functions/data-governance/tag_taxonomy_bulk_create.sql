/**
 * Create several tag taxonomies in one request.
 *
 * Check `has_errors` and each `results[].statusCode`, since single items can fail.
 */

call cdp.tag_taxonomy_bulk_create (
    taxonomies => [
        (name = 'Compliance_Tags', label = 'Compliance Tags', description = 'Compliance-related tags.'),
        (name = 'Ethics_Tags', label = 'Ethics Tags', description = 'Ethical AI compliance indicators.'),
        (name = 'Marketing_Tags', label = 'Marketing Tags', description = 'Marketing consent and preference tags.')
    ]
);

call cdp.tag_taxonomy_list (search_string => 'Tags');
