/**
 * Read the messages of one session of a knowledge space.
 *
 * The spec contradicts itself: its schema has `message`, `text` and `message_type`, its example has `role` and `content`. If the example is right, the data is only in the raw result.
 */

call cdp.knowledge_space_session_list (knowledge_space_api_name_or_id => '1T8xx0000004CYqCAM', limit => 20);

call cdp.session_conversation_list (
    knowledge_space_api_name_or_id => '1T8xx0000004CYqCAM',
    knowledge_space_session_id => 'session-123'
);
