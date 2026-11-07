/**
 * Find retrievers, out-of-the-box ones first. Use it to look up the `name` the other retriever calls take, and to check for an existing label before you create one: retrying a create makes a duplicate.
 *
 * The filters combine. `limit` goes from 1 to 200, and -1 means no limit.
 */

call cdp.retriever_list (
    search => 'Bathroom',
    detail_level => 'Basic',
    is_active => true,
    query_type => 'NoCode',
    sort_by => 'LastModifiedDate',
    sort_order => 'Descending',
    limit => 50,
    _pages => 2
);
