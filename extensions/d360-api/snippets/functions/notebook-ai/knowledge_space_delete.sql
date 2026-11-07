/**
 * Delete a knowledge space that is no longer used. Read it first to see its libraries and files.
 *
 * No source says what happens to the space's libraries, files or sessions.
 */

call cdp.knowledge_space_details_get (knowledge_space_api_name_or_id => '1T8xx0000004CYqCAM');

call cdp.knowledge_space_delete (knowledge_space_api_name_or_id => '1T8xx0000004CYqCAM');
