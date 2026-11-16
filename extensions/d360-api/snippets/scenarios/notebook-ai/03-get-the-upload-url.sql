/**
 * Step 3 of Notebook AI.
 *
 * Get a URL for `:library_id`, and PUT the file to it outside DashQL.
 */

call d360.presigned_urls_get (library_id => :library_id, file_names => ['report.pdf']);
