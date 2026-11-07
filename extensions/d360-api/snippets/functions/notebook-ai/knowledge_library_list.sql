/**
 * List all knowledge libraries, to find the library id for uploads and library details.
 *
 * There is no space filter. `knowledge_category` is `PERSONAL` or `ENTERPRISE` in the spec's examples. Agentforce Data Libraries (`1JD` ids) are a different surface.
 */

call cdp.knowledge_library_list ();

call cdp.knowledge_library_details_get (library_id => '1aQxx00000000JNEAY');
