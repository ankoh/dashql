/**
 * Read one library with the files of its sources.
 *
 * It returns one row, the files are nested in the `sources` column.
 */

call cdp.knowledge_library_list ();

call cdp.knowledge_library_details_get (library_id => '1aQxx00000000JNEAY');
