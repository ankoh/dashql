/**
 * Link a classification to a tag.
 *
 * This labels no data. To tag a field, use `tag_assignment_create`.
 */

call cdp.classification_assignment_create (
    classification_fully_qualified_name => 'Compliance_Classifications.PII',
    tag_fully_qualified_name => 'Compliance_Tags.PII.Email'
);

call cdp.classification_assignment_list (classification_fully_qualified_name => 'Compliance_Classifications.PII');
