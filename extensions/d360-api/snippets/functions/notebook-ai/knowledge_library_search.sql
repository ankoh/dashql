/**
 * Look up a library of a knowledge space by its developer name.
 *
 * This is a read that uses POST. No source says whether the match is exact or partial.
 */

call cdp.knowledge_library_search (knowledge_space_id => '1T8xx0000004CYqCAM', developer_name => 'Product_Docs');
