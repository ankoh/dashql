/**
 * Check the indexing status of files in a knowledge space by their file record ids.
 *
 * The ids are `file_record_id` values. The kit that documents the upload flow polls `knowledge_space_details_get` instead, and reports `INDEXED`, `IN_PROGRESS`, `PROCESSING` and `FAILED`.
 */

call cdp.file_status_get (
    knowledge_space_id => '1T8xx0000004CYqCAM',
    file_ids => ['1Utxx0000004DJcCAM', '1Utxx0000004DJdCAM']
);
