/**
 * Step 4 of semantic search, needs the ready index of step 3.
 *
 * Search is SQL over the connection, not a call. The chunk object gives the matching text.
 */

select v."hybrid_score__c", c."Chunk__c", c."SourceRecordId__c"
from hybrid_search(table("Articles_Search_index__dlm"), 'reset password', '', 5) v
    join "Articles_Search_chunk__dlm" c on c."RecordId__c" = v."RecordId__c"
order by v."hybrid_score__c" desc
limit 5;
