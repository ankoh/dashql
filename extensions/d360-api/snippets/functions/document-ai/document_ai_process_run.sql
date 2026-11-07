/**
 * Start a batch run of a saved configuration over the documents of its source DMO.
 *
 * It returns as soon as the run is triggered. Don't retry blindly: the sources don't say whether a repeat run reprocesses documents, and batch runs spend credits. Poll `runtime_status` and `last_run_on` of the configuration, `Ready` may not mean the run finished.
 */

call cdp.document_ai_process_run (id_or_api_name => 'Vendor_Invoice');

call cdp.document_ai_configuration_get (id_or_api_name => 'Vendor_Invoice');
