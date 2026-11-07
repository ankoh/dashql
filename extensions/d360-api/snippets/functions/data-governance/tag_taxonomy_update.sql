/**
 * Rename or describe a tag taxonomy.
 *
 * Omitted fields stay as they are.
 */

call cdp.tag_taxonomy_update (
    fully_qualified_name => 'Compliance_Tags',
    label => 'Compliance Tags (GA)',
    description => 'Compliance-related tags: PII, financial and health indicators.'
);
