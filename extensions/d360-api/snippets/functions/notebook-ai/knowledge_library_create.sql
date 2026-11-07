/**
 * Add a library to a knowledge space, to keep a group of documents apart.
 *
 * You don't need it to upload files, the space already has a personal library.
 */

call cdp.knowledge_library_create (
    knowledge_space_id => '1T8xx0000004CYqCAM',
    developer_name => 'Product_Docs',
    label => 'Product Docs',
    description => 'Manuals and release notes'
);

call cdp.knowledge_library_search (knowledge_space_id => '1T8xx0000004CYqCAM', developer_name => 'Product_Docs');
