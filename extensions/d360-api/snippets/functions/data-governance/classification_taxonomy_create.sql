/**
 * Create a taxonomy to hold classifications.
 *
 * Pass the `name` even though the spec marks it optional. It is one developer name without a dot, and the label must be unique.
 */

call cdp.classification_taxonomy_create (
    name => 'Compliance_Classifications',
    label => 'Compliance Classifications',
    description => 'Sensitivity and compliance classifications.'
);
