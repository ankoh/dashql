/**
 * Step 1 of Notebook AI.
 *
 * Create a knowledge space. The `knowledge_space_id` in the result is the `:knowledge_space_id` of the next step.
 */

call cdp.knowledge_space_create (label => 'Diagnosis', developer_name => 'Diagnosis', dataspace => 'default');
