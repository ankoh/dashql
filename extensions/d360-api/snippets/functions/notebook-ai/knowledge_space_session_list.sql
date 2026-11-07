/**
 * List the sessions of a knowledge space, up to a limit, then read the conversation of one.
 *
 * `limit` is the only paging control. The result has both `session_id` and `knowledge_space_session_entity_id`, and no source says which one the session calls expect.
 */

call cdp.knowledge_space_session_list (knowledge_space_api_name_or_id => '1T8xx0000004CYqCAM', limit => 20);

call cdp.session_conversation_list (
    knowledge_space_api_name_or_id => '1T8xx0000004CYqCAM',
    knowledge_space_session_id => 'session-123'
);
