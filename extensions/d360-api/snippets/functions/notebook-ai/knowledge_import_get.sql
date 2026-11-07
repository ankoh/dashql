/**
 * See which libraries and search indexes can be imported into a knowledge space. It changes nothing. Use it to get the ids for `knowledge_import`.
 *
 * This is a read that uses POST. The spec's example sends only the space id.
 */

call cdp.knowledge_import_get (knowledge_space_id => '1T8xx0000004CYqCAM');

call cdp.knowledge_import (
    knowledge_space_id => '1T8xx0000004CYqCAM',
    selected_list => (knowledge_ids = ['1aQxx000000003FEAQ'], search_indexes = ['18lxx0000004C92AAE'])
);
