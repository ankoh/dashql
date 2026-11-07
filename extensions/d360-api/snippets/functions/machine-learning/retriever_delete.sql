/**
 * Delete a retriever with all its configuration versions, for instance the duplicate a retried `retriever_create` left behind. The retriever must not be used by other entities.
 *
 * Read it first, and take the top-level `name`, not the name of the active configuration. A success may come back as HTTP 204 or 200.
 */

call cdp.retriever_get (retriever_id_or_name => 'DIY_Bathroom_Retriever_1Cx_9H02ce17169');

call cdp.retriever_delete (retriever_id_or_name => 'DIY_Bathroom_Retriever_1Cx_9H02ce17169');
