/**
 * Remove a library from a knowledge space. Read the library first.
 *
 * No source says whether the library itself survives.
 */

call cdp.knowledge_library_details_get (library_id => '1aQxx00000000G9EAI');

call cdp.knowledge_library_remove (
    knowledge_library_id => '1aQxx00000000G9EAI',
    knowledge_space_id => '1T8xx0000004CYqCAM'
);
