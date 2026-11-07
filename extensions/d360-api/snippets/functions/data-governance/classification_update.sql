/**
 * Change a classification and replace the tags it is linked to.
 *
 * The list of tags replaces all links. An empty list removes them, and leaving it out keeps them.
 */

call cdp.classification_update (
    fully_qualified_name => 'Compliance_Classifications.PII',
    label => 'Personal Data',
    description => 'Personally identifiable information, direct and indirect identifiers.',
    tag_fully_qualified_names => [
        'Compliance_Tags.PII.Email',
        'Compliance_Tags.PII.CreditCard',
        'Compliance_Tags.PII.Phone'
    ]
);
