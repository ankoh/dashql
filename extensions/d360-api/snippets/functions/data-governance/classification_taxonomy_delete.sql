/**
 * Delete a classification taxonomy that is no longer used.
 *
 * A taxonomy that still has child classifications or external dependencies is refused with a 412, so remove those first. The delete is accepted at once and finishes in the background: it is done when `classification_taxonomy_get` returns 404.
 */

call cdp.classification_taxonomy_get (name => 'Data_Residency_Classifications');

call cdp.classification_taxonomy_delete (name => 'Data_Residency_Classifications');
