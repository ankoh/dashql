/**
 * Read one session of a knowledge space by its id.
 *
 * The call takes no knowledge space, but `session_conversation_list` needs both ids.
 */

call cdp.knowledge_space_session_list (knowledge_space_api_name_or_id => '1T8xx0000004CYqCAM');

call cdp.knowledge_space_session_get (knowledge_space_session_id => 'session-123');
