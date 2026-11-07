/**
 * Create a top-level taxonomy to hold tags.
 *
 * Pass the `name` even though the spec marks it optional. It is one developer name without a dot, and the label must be unique.
 */

call cdp.tag_taxonomy_create (
    name => 'Compliance_Tags',
    label => 'Compliance Tags',
    description => 'Compliance-related tags (PII, financial, health).'
);
