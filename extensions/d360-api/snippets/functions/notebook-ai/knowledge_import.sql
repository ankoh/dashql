/**
 * Import existing knowledge libraries and search indexes into a knowledge space.
 *
 * Take `knowledge_ids` from `knowledge_list[].knowledgeLibraryId` and `search_indexes` from `search_indexes[].id` of `knowledge_import_get`.
 */

call cdp.knowledge_import_get (knowledge_space_id => '1T8xx0000004CYqCAM');

call cdp.knowledge_import (
    knowledge_space_id => '1T8xx0000004CYqCAM',
    selected_list => (
        knowledge_ids = ['1aQxx000000003FEAQ', '1aQxx00000000G9EAI'],
        search_indexes = ['18lxx0000004C92AAE']
    )
);
