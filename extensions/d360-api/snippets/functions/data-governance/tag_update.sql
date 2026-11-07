/**
 * Change a tag: its label, its description and the classifications it belongs to.
 *
 * The classification list replaces all links, an empty list removes them. `parent_tag_fully_qualified_name` moves the tag below another tag of the same taxonomy.
 */

call cdp.tag_update (
    fully_qualified_name => 'Compliance_Tags.PII.Email',
    label => 'Email Address (PII)',
    description => 'Personal and work email fields.',
    classification_fully_qualified_names => ['Compliance_Classifications.PII', 'Compliance_Classifications.Sensitive']
);
