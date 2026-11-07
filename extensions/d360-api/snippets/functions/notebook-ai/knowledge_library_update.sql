/**
 * Rename a knowledge library and change its description.
 *
 * `id` is the library to change.
 */

call cdp.knowledge_library_update (
    id => '1aQxx00000000JNEAY',
    label => 'Product Docs',
    description => 'Manuals and release notes'
);

call cdp.knowledge_library_details_get (library_id => '1aQxx00000000JNEAY');
