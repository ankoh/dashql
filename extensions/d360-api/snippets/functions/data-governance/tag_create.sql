/**
 * Create a tag in a taxonomy, with its description and the classifications it belongs to.
 *
 * The path is `<Taxonomy>.<Level1>[.<Level2>]`: two or three segments, and the taxonomy and the parent in it must already exist.
 */

call cdp.tag_create (
    fully_qualified_name => 'Compliance_Tags.PII.Email',
    label => 'Email Address',
    description => 'Personally identifiable email addresses.',
    classification_fully_qualified_names => ['Compliance_Classifications.PII']
);
