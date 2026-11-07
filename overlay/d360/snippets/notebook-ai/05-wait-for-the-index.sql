/**
 * Step 5 of Notebook AI.
 *
 * Repeat on `:knowledge_space_id` until the file is indexed.
 */

call cdp.knowledge_space_details_get (knowledge_space_api_name_or_id => :knowledge_space_id);
