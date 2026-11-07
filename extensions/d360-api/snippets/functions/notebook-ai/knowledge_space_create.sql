/**
 * Create a knowledge space, a notebook, in a data space. It comes with a personal library to upload into.
 *
 * Notebook AI has to be on for the org, otherwise it fails with `No Knowledge Space Config Found For the DataSpace`, and retrying doesn't help. `developer_name` takes letters, digits and underscores, and Salesforce can add a suffix, so look it up by `label` later.
 */

call cdp.knowledge_space_create (
    label => 'Diagnosis',
    developer_name => 'Diagnosis',
    description => 'Clinical guidelines and diagnosis reports',
    dataspace => 'default',
    create_default_library => true
);

call cdp.knowledge_space_list ();
