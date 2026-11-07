/**
 * Open a new session on a knowledge space.
 *
 * Sessions aren't needed to upload or index files, and no function here sends a prompt to a session. The spec's example repeats the space id in the body and supplies its own `session_id`.
 */

call cdp.knowledge_space_session_create (
    knowledge_space_api_name_or_id => '1T8xx0000004CYqCAM',
    knowledge_space_id => '1T8xx0000004CYqCAM',
    session_id => 'session-123'
);

call cdp.knowledge_space_session_list (knowledge_space_api_name_or_id => '1T8xx0000004CYqCAM', limit => 20);
