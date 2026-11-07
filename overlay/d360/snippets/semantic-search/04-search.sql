/**
 * Step 4 of semantic search, needs the ready index of step 3.
 *
 * Search is SQL over the connection, not a call. The chunk object gives the matching text.
 */

SELECT v."hybrid_score__c", c."Chunk__c", c."SourceRecordId__c"
FROM hybrid_search(TABLE("Articles_Search_index__dlm"), 'reset password', '', 5) AS v
INNER JOIN "Articles_Search_chunk__dlm" AS c ON c."RecordId__c" = v."RecordId__c"
ORDER BY v."hybrid_score__c" DESC
LIMIT 5;
