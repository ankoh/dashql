/**
 * List the knowledge spaces, the notebooks of Notebook AI, to find the id or name the other calls take.
 *
 * An empty list does not mean Notebook AI is available: it comes back empty with success on enabled and disabled orgs. `knowledge_space_create` is the real check. To find a space, match on `label`, the developer name can carry a suffix.
 */

call cdp.knowledge_space_list ();

call cdp.knowledge_space_get (knowledge_space_api_name_or_id => '1T8xx0000004CYqCAM');
