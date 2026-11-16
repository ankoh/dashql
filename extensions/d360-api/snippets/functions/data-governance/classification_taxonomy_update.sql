/**
 * Rename or describe a classification taxonomy.
 *
 * Omitted fields stay as they are.
 */

call d360.classification_taxonomy_update (
    name => 'Compliance_Classifications',
    label => 'Compliance Classifications (GA)',
    description => 'Sensitivity and compliance classifications for regulated workloads.'
);
