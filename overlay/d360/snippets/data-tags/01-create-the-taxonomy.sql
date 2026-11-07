/**
 * Step 1 of tagging data.
 *
 * Create the taxonomy that holds the tags.
 */

call cdp.tag_taxonomy_create (name => 'Compliance_Tags', label => 'Compliance Tags');
