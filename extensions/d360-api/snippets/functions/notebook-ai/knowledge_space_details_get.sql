/**
 * Read a knowledge space with its libraries, sources and files, to find the library to upload into and to poll file indexing.
 *
 * It returns one row, the data is nested in the `libraries` column, at `libraries[].sources[].files[]`. Upload into the library with `knowledge_category` `PERSONAL`. `sources` stays empty until indexing starts.
 */

call cdp.knowledge_space_list ();

call cdp.knowledge_space_details_get (knowledge_space_api_name_or_id => '1T8xx0000004CYqCAM');
