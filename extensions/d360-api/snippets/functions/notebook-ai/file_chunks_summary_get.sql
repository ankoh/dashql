/**
 * Read all text chunks of the files behind a search index, for the containers you name.
 *
 * It returns one row, `all_chunks` is a single string with the chunk text run together. The spec doesn't define `container_id`.
 */

call cdp.file_chunks_summary_get (
    search_index_name => 'KnowledgeIndex',
    container_id => ['container-1', 'container-2']
);
