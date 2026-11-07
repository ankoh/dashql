/**
 * Read one knowledge space by id or API name, after finding it in the list.
 *
 * The answer has no libraries. Use `knowledge_space_details_get` when you need libraries or files.
 */

call cdp.knowledge_space_list ();

call cdp.knowledge_space_get (knowledge_space_api_name_or_id => '1T8xx0000004CYqCAM');
