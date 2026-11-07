/**
 * Start indexing files that were uploaded to a library. It is the last step of the upload flow, after `presigned_urls_get` and the S3 upload.
 *
 * `file_path` is `collections/<library id>/<file name>`. Accepted types are PDF, TXT and HTML. Indexing takes minutes and the call can return a 500 after it started, so read the file status before you send it again, a second send can start a duplicate job. Poll `fileStatus` in `libraries[].sources[].files[]` until it is `INDEXED` or `FAILED`.
 */

call cdp.files_index (
    knowledge_artifact_id => '1aQxx00000000JNEAY',
    knowledge_artifact_source => 'FILE_UPLOAD',
    knowledge_source_files_list => [
        (file_name = 'report.pdf', file_path = 'collections/1aQxx00000000JNEAY/report.pdf', file_type = 'PDF'),
        (file_name = 'notes.txt', file_path = 'collections/1aQxx00000000JNEAY/notes.txt', file_type = 'TXT')
    ]
);

call cdp.knowledge_space_details_get (knowledge_space_api_name_or_id => '1T8xx0000004CYqCAM');
