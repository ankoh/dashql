/**
 * Change several tags in one request: labels, a new parent, classifications.
 *
 * Validation runs against the state before the batch, so an item doesn't see the re-parenting of another.
 */

call d360.tag_bulk_update (
    items => [
        (fully_qualified_name = 'Compliance_Tags.PII.Email', label = 'Email Address (PII)'),
        (
            fully_qualified_name = 'Compliance_Tags.PII.Phone',
            parent_tag_fully_qualified_name = 'Compliance_Tags.PII.Contact'
        ),
        (
            fully_qualified_name = 'Compliance_Tags.PII.CreditCard',
            classification_fully_qualified_names = [
                'Compliance_Classifications.PII',
                'Compliance_Classifications.Sensitive'
            ]
        )
    ]
);

call d360.tag_list (taxonomy_name => 'Compliance_Tags', search_string => 'PII');
