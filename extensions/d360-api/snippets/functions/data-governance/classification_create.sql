/**
 * Create a classification below a taxonomy and link it to tags in the same call.
 *
 * The path has two or three segments and the taxonomy in front must exist. When a tag link fails the classification is still created, so compare `tags` in the result with what you sent.
 */

call cdp.classification_create (
    fully_qualified_name => 'Compliance_Classifications.PII',
    label => 'PII',
    description => 'Personally identifiable information.',
    tag_fully_qualified_names => ['Compliance_Tags.PII.Email', 'Compliance_Tags.PII.CreditCard']
);
