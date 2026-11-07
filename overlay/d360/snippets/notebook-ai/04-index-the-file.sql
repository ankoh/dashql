/**
 * Step 4 of Notebook AI.
 *
 * Index the uploaded file. `:library_id` comes from the previous step, and `:file_path` is `collections/<library id>/report.pdf`.
 */

call cdp.files_index (
    knowledge_artifact_id => :library_id,
    knowledge_artifact_source => 'FILE_UPLOAD',
    knowledge_source_files_list => [(file_name = 'report.pdf', file_path = :file_path, file_type = 'PDF')]
);
