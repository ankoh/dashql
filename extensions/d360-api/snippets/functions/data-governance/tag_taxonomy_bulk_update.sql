/**
 * Relabel or describe several tag taxonomies in one request.
 *
 * Each item names its taxonomy and sends only what changes, the rest stays.
 */

call cdp.tag_taxonomy_bulk_update (
    items => [
        (name = 'Compliance_Tags', label = 'Compliance Tags (GA)'),
        (name = 'Ethics_Tags', description = 'Ethical AI tags: caste, gender, accessibility.')
    ]
);

call cdp.tag_taxonomy_list (search_string => 'Tags');
