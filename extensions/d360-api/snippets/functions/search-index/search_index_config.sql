/**
 * Read the choices a search index can be built from: chunking strategies, embedding models, index types, similarity metrics and transcription models.
 *
 * Take the ids for the create call from here. `config` is one string of JSON whose quotes are encoded as `&quot;`, so decode the entities and then parse it.
 */

call cdp.search_index_config ();

call cdp.search_index_list ();
