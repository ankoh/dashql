/**
 * Rename a knowledge space and change its description.
 *
 * The spec's example changes only `label` and `description`. No source says which other fields can change.
 */

call cdp.knowledge_space_update (
    knowledge_space_api_name_or_id => '1T8xx0000004CYqCAM',
    label => 'Diagnosis Notebook',
    description => 'Clinical guidelines and diagnosis reports'
);

call cdp.knowledge_space_get (knowledge_space_api_name_or_id => '1T8xx0000004CYqCAM');
