/**
 * Get one S3 upload URL per file for a library. The upload itself is a plain `PUT` outside SQL, then `files_index` starts the indexing.
 *
 * Five files per call at most. The URLs come back in the order of `file_names`. Treat them as credentials and keep them out of logs. Leave `&amp;` in the URL as `&`, and send no header, not even `Content-Type`, or S3 answers 403.
 */

call cdp.presigned_urls_get (library_id => '1aQxx00000000JNEAY', file_names => ['report.pdf', 'notes.txt']);
