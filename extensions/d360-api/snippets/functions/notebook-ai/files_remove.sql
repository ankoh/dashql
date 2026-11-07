/**
 * Remove files from a knowledge library, here two files that were replaced.
 *
 * The spec's example uses the `file_path` form `collections/<library id>/<file name>`. Check the library first for the files that are there.
 */

call cdp.knowledge_library_details_get (library_id => '1aQxx00000000JNEAY');

call cdp.files_remove (
    knowledge_artifact_id => '1aQxx00000000JNEAY',
    knowledge_artifact_source => 'FILE_UPLOAD',
    knowledge_source_files_list => [
        (file_name = 'old-document.pdf', file_path = 'collections/1aQxx00000000JNEAY/old-document.pdf'),
        (file_name = 'draft-notes.txt', file_path = 'collections/1aQxx00000000JNEAY/draft-notes.txt')
    ]
);
