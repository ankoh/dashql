/**
 * Read which file types, size limits and models the org accepts for Document AI.
 *
 * Reach for it to find valid `ml_model` values before creating a configuration or extracting, and read `max_file_size_in_mb` here instead of assuming a limit, since the sources disagree on it.
 */

call cdp.document_ai_global_configuration_get ();

call cdp.document_ai_configuration_list (limit => 25);
