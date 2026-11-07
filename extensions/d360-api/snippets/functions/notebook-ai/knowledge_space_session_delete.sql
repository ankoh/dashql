/**
 * Delete a session of a knowledge space. Read it first to be sure it is the one you mean.
 */

call cdp.knowledge_space_session_get (knowledge_space_session_id => 'session-123');

call cdp.knowledge_space_session_delete (knowledge_space_session_id => 'session-123');
