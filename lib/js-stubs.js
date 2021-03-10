mergeInto(LibraryManager.library, {
    dashql_blob_stream_underflow: function(blobId, buf, size) {
        return WebDBTrampoline['dashql_blob_stream_underflow'](blobId, buf, size);
    },
});