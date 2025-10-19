#include "dashql/api.h"

#include <flatbuffers/buffer.h>
#include <flatbuffers/detached_buffer.h>
#include <flatbuffers/flatbuffer_builder.h>

#include <span>

#include "dashql/analyzer/completion.h"
#include "dashql/buffers/index_generated.h"
#include "dashql/catalog.h"
#include "dashql/catalog_object.h"
#include "dashql/script.h"
#include "dashql/version.h"

using namespace dashql;
using namespace dashql::parser;

/// Log to console
#ifdef WASM
__attribute__((__import_module__("env"), __import_name__("log"))) extern void log(const char* text, size_t textLength);
#else
extern void log(const char* text, size_t textLength) { std::cout << std::string_view{text, textLength} << std::endl; }
#endif

namespace console {
/// Log a std::string
void log(std::string text) { return ::log(text.data(), text.size()); }
/// Log a string_view
void log(std::string_view text) { return ::log(text.data(), text.size()); }
}  // namespace console

static FFIResult* packOK() {
    auto result = std::make_unique<FFIResult>();
    result->status_code = static_cast<uint32_t>(buffers::status::StatusCode::OK);
    result->data_ptr = nullptr;
    result->data_length = 0;
    result->owner_ptr = nullptr;
    result->owner_deleter = [](void*) {};
    return result.release();
}

template <typename T> static FFIResult* packPtr(std::unique_ptr<T> ptr) {
    auto result = std::make_unique<FFIResult>();
    auto raw_ptr = ptr.release();
    result->status_code = static_cast<uint32_t>(buffers::status::StatusCode::OK);
    result->data_ptr = nullptr;
    result->data_length = 0;
    result->owner_ptr = raw_ptr;
    result->owner_deleter = [](void* p) { delete reinterpret_cast<T*>(p); };
    return result.release();
}

static FFIResult* packBuffer(std::unique_ptr<flatbuffers::DetachedBuffer> detached) {
    auto result = std::make_unique<FFIResult>();
    result->status_code = static_cast<uint32_t>(buffers::status::StatusCode::OK);
    result->data_ptr = detached->data();
    result->data_length = detached->size();
    result->owner_ptr = detached.release();
    result->owner_deleter = [](void* buffer) { delete reinterpret_cast<flatbuffers::DetachedBuffer*>(buffer); };
    return result.release();
}

static FFIResult* packError(buffers::status::StatusCode status) {
    std::string_view message;
    switch (status) {
        case buffers::status::StatusCode::CATALOG_NULL:
            message = "Catalog is null";
            break;
        case buffers::status::StatusCode::CATALOG_MISMATCH:
            message = "Catalog is not matching";
            break;
        case buffers::status::StatusCode::CATALOG_ID_OUT_OF_SYNC:
            message = "Catalog id is out of sync";
            break;
        case buffers::status::StatusCode::SCRIPT_NOT_SCANNED:
            message = "Script is not scanned";
            break;
        case buffers::status::StatusCode::SCRIPT_NOT_PARSED:
            message = "Script is not parsed";
            break;
        case buffers::status::StatusCode::SCRIPT_NOT_ANALYZED:
            message = "Script is not analyzed";
            break;
        case buffers::status::StatusCode::CATALOG_SCRIPT_NOT_ANALYZED:
            message = "Unanalyzed scripts cannot be added to the catalog";
            break;
        case buffers::status::StatusCode::CATALOG_SCRIPT_UNKNOWN:
            message = "Script is missing in catalog";
            break;
        case buffers::status::StatusCode::CATALOG_DESCRIPTOR_POOL_UNKNOWN:
            message = "Schema descriptor pool is not known";
            break;
        case buffers::status::StatusCode::CATALOG_DESCRIPTOR_TABLES_NULL:
            message = "Schema descriptor field `tables` is null or empty";
            break;
        case buffers::status::StatusCode::CATALOG_DESCRIPTOR_TABLE_NAME_EMPTY:
            message = "Table name in schema descriptor is null or empty";
            break;
        case buffers::status::StatusCode::CATALOG_DESCRIPTOR_TABLE_NAME_COLLISION:
            message = "Schema descriptor contains a duplicate table name";
            break;
        case buffers::status::StatusCode::COMPLETION_MISSES_CURSOR:
            message = "Completion requires a script cursor";
            break;
        case buffers::status::StatusCode::COMPLETION_MISSES_SCANNER_TOKEN:
            message = "Completion requires a scanner token";
            break;
        case buffers::status::StatusCode::COMPLETION_STATE_INCOMPATIBLE:
            message = "Completion state is incompatible";
            break;
        case buffers::status::StatusCode::COMPLETION_STRATEGY_UNKNOWN:
            message = "Completion strategy is unknown";
            break;
        case buffers::status::StatusCode::COMPLETION_WITHOUT_CONTINUATION:
            message = "Completion has no continuation";
            break;
        case buffers::status::StatusCode::COMPLETION_CANDIDATE_INVALID:
            message = "Completion candidate is invalid";
            break;
        case buffers::status::StatusCode::COMPLETION_CATALOG_OBJECT_INVALID:
            message = "Completion catalog object is invalid";
            break;
        case buffers::status::StatusCode::COMPLETION_TEMPLATE_INVALID:
            message = "Completion template is invalid";
            break;
        case buffers::status::StatusCode::EXTERNAL_ID_COLLISION:
            message = "Collision on external identifier";
            break;
        case buffers::status::StatusCode::VIEWMODEL_INPUT_JSON_PARSER_ERROR:
            message = "Failed to parse JSON for ViewModel";
            break;
        case buffers::status::StatusCode::OK:
            message = "";
            break;
    }
    auto result = new FFIResult();
    result->status_code = static_cast<uint32_t>(status);
    result->data_ptr = static_cast<const void*>(message.data());
    result->data_length = message.size();
    result->owner_ptr = nullptr;
    result->owner_deleter = [](void*) {};
    return result;
}

/// Get the DashQL version
extern "C" DashQLVersion* dashql_version() { return &dashql::VERSION; }

/// Allocate memory
extern "C" std::byte* dashql_malloc(size_t length) { return new std::byte[length]; }
/// Delete memory
extern "C" void dashql_free(const void* buffer) { delete[] reinterpret_cast<const std::byte*>(buffer); }

/// Delete a result
extern "C" void dashql_delete_result(FFIResult* result) {
    result->owner_deleter(result->owner_ptr);
    result->owner_ptr = nullptr;
    result->owner_deleter = nullptr;
    delete result;
}

/// Create a script
extern "C" FFIResult* dashql_script_new(dashql::Catalog* catalog, uint32_t external_id) {
    if (!catalog) {
        return packError(buffers::status::StatusCode::CATALOG_NULL);
    }
    if (catalog && catalog->Contains(external_id)) {
        return packError(buffers::status::StatusCode::EXTERNAL_ID_COLLISION);
    }
    // Construct the script
    auto script = std::make_unique<Script>(*catalog, external_id);
    return packPtr(std::move(script));
}
/// Insert char at a position
extern "C" void dashql_script_insert_char_at(Script* script, size_t offset, uint32_t unicode) {
    script->InsertCharAt(offset, unicode);
}
/// Insert text at a position
extern "C" void dashql_script_insert_text_at(Script* script, size_t offset, const char* text_ptr, size_t text_length) {
    std::string_view text{text_ptr, text_length};
    script->InsertTextAt(offset, text);
    dashql_free(text_ptr);
}
/// Replace text in a script
extern "C" void dashql_script_replace_text(dashql::Script* script, const char* text_ptr, size_t text_length) {
    std::string_view text{text_ptr, text_length};
    script->ReplaceText(text);
    dashql_free(text_ptr);
}
/// Erase a text range
extern "C" void dashql_script_erase_text_range(Script* script, size_t offset, size_t count) {
    script->EraseTextRange(offset, count);
}
/// Get the script content as string
extern "C" FFIResult* dashql_script_to_string(Script* script) {
    auto text = std::make_unique<std::string>(std::move(script->ToString()));
    auto result = new FFIResult();
    result->status_code = static_cast<uint32_t>(buffers::status::StatusCode::OK);
    result->data_ptr = text->data();
    result->data_length = text->length();
    result->owner_ptr = text.release();
    result->owner_deleter = [](void* buffer) { delete reinterpret_cast<std::string*>(buffer); };
    return result;
}

/// Scan a script
extern "C" FFIResult* dashql_script_scan(Script* script) {
    auto status = script->Scan();
    if (status != buffers::status::StatusCode::OK) {
        return packError(status);
    } else {
        return packOK();
    }
}
/// Parse a script
extern "C" FFIResult* dashql_script_parse(Script* script) {
    auto status = script->Parse();
    if (status != buffers::status::StatusCode::OK) {
        return packError(status);
    } else {
        return packOK();
    }
}
/// Analyze a script
extern "C" FFIResult* dashql_script_analyze(Script* script, bool parse_if_outdated) {
    auto status = script->Analyze(parse_if_outdated);
    if (status != buffers::status::StatusCode::OK) {
        return packError(status);
    } else {
        return packOK();
    }
}

/// Get the parsed script
extern "C" FFIResult* dashql_script_get_scanned(Script* script) {
    if (script->scanned_script == nullptr) {
        return packError(buffers::status::StatusCode::SCRIPT_NOT_ANALYZED);
    }

    // Pack a parsed script
    flatbuffers::FlatBufferBuilder fb;
    fb.Finish(script->scanned_script->Pack(fb));
    auto detached = std::make_unique<flatbuffers::DetachedBuffer>(std::move(fb.Release()));
    return packBuffer(std::move(detached));
}

/// Get the parsed script
extern "C" FFIResult* dashql_script_get_parsed(Script* script) {
    if (script->parsed_script == nullptr) {
        return packError(buffers::status::StatusCode::SCRIPT_NOT_ANALYZED);
    }

    // Pack a parsed script
    flatbuffers::FlatBufferBuilder fb;
    fb.Finish(script->parsed_script->Pack(fb));
    auto detached = std::make_unique<flatbuffers::DetachedBuffer>(std::move(fb.Release()));
    return packBuffer(std::move(detached));
}

/// Get the analyzed script
extern "C" FFIResult* dashql_script_get_analyzed(Script* script) {
    if (script->analyzed_script == nullptr) {
        return packError(buffers::status::StatusCode::SCRIPT_NOT_ANALYZED);
    }

    // Pack a parsed script
    flatbuffers::FlatBufferBuilder fb;
    fb.Finish(script->analyzed_script->Pack(fb));
    auto detached = std::make_unique<flatbuffers::DetachedBuffer>(std::move(fb.Release()));
    return packBuffer(std::move(detached));
}

/// Get script id
extern "C" uint32_t dashql_script_get_catalog_entry_id(dashql::Script* script) { return script->GetCatalogEntryId(); }

/// Move the cursor to a script at a position
extern "C" FFIResult* dashql_script_move_cursor(dashql::Script* script, size_t text_offset) {
    auto [cursor, status] = script->MoveCursor(text_offset);
    if (status != buffers::status::StatusCode::OK) {
        return packError(status);
    }

    // Pack the cursor info
    flatbuffers::FlatBufferBuilder fb;
    fb.Finish(cursor->Pack(fb));

    // Store the buffer
    auto detached = std::make_unique<flatbuffers::DetachedBuffer>(std::move(fb.Release()));
    return packBuffer(std::move(detached));
}

extern "C" FFIResult* dashql_script_complete_at_cursor(dashql::Script* script, size_t limit,
                                                       dashql::ScriptRegistry* registry) {
    auto [completion, status] = script->CompleteAtCursor(limit, registry);
    if (status != buffers::status::StatusCode::OK) {
        return packError(status);
    }

    // Pack the completion
    flatbuffers::FlatBufferBuilder fb;
    fb.Finish(completion->Pack(fb));

    // Store the buffer
    auto detached = std::make_unique<flatbuffers::DetachedBuffer>(std::move(fb.Release()));
    return packBuffer(std::move(detached));
}

extern "C" FFIResult* dashql_script_select_completion_candidate_at_cursor(dashql::Script* script,
                                                                          const void* prev_completion_bytes,
                                                                          size_t candidate_id) {
    // Read the previous completion
    auto* prev_completion = flatbuffers::GetRoot<buffers::completion::Completion>(prev_completion_bytes);

    // Select the completion candidate
    flatbuffers::FlatBufferBuilder fb;
    auto [completion, status] = script->SelectCompletionCandidateAtCursor(fb, *prev_completion, candidate_id);
    if (status != buffers::status::StatusCode::OK) {
        return packError(status);
    }
    fb.Finish(completion);

    // Store the buffer
    auto detached = std::make_unique<flatbuffers::DetachedBuffer>(std::move(fb.Release()));
    return packBuffer(std::move(detached));
}

extern "C" FFIResult* dashql_script_select_completion_catalog_object_at_cursor(dashql::Script* script,
                                                                               const void* prev_completion_bytes,
                                                                               size_t candidate_id,
                                                                               size_t catalog_object_idx) {
    // Read the previous completion
    auto* prev_completion = flatbuffers::GetRoot<buffers::completion::Completion>(prev_completion_bytes);

    // Select the completion candidate
    flatbuffers::FlatBufferBuilder fb;
    auto [completion, status] =
        script->SelectCompletionCatalogObjectAtCursor(fb, *prev_completion, candidate_id, catalog_object_idx);
    if (status != buffers::status::StatusCode::OK) {
        return packError(status);
    }
    fb.Finish(completion);

    // Store the buffer
    auto detached = std::make_unique<flatbuffers::DetachedBuffer>(std::move(fb.Release()));
    return packBuffer(std::move(detached));
}

extern "C" FFIResult* dashql_script_get_statistics(dashql::Script* script) {
    auto stats = script->GetStatistics();

    // Pack a schema graph
    flatbuffers::FlatBufferBuilder fb;
    fb.Finish(buffers::statistics::ScriptStatistics::Pack(fb, stats.get()));

    // Return the buffer
    auto detached = std::make_unique<flatbuffers::DetachedBuffer>(std::move(fb.Release()));
    return packBuffer(std::move(detached));
}

/// Create a catalog
extern "C" FFIResult* dashql_catalog_new(const char* database_name_ptr, size_t database_name_length,
                                         const char* schema_name_ptr, size_t schema_name_length) {
    // Free argument buffers
    // XXX Get rid of the arguments
    dashql_free(database_name_ptr);
    dashql_free(schema_name_ptr);
    return packPtr(std::make_unique<dashql::Catalog>());
}
/// Clear a catalog
extern "C" void dashql_catalog_clear(dashql::Catalog* catalog) { catalog->Clear(); }
/// Get script id
extern "C" bool dashql_catalog_contains_entry_id(dashql::Catalog* catalog, uint32_t entry_id) {
    return catalog->Contains(entry_id);
}
/// Describe all entries
extern "C" FFIResult* dashql_catalog_describe_entries(dashql::Catalog* catalog) {
    flatbuffers::FlatBufferBuilder fb;
    auto entries = catalog->DescribeEntries(fb);
    fb.Finish(entries);

    auto detached = std::make_unique<flatbuffers::DetachedBuffer>(std::move(fb.Release()));
    return packBuffer(std::move(detached));
}
/// Describe all entries
extern "C" FFIResult* dashql_catalog_describe_entries_of(dashql::Catalog* catalog, size_t entry_id) {
    flatbuffers::FlatBufferBuilder fb;
    auto entries = catalog->DescribeEntriesOf(fb, entry_id);
    fb.Finish(entries);

    auto detached = std::make_unique<flatbuffers::DetachedBuffer>(std::move(fb.Release()));
    return packBuffer(std::move(detached));
}
/// Flatten the catalog
extern "C" FFIResult* dashql_catalog_flatten(dashql::Catalog* catalog) {
    flatbuffers::FlatBufferBuilder fb;
    auto entries = catalog->Flatten(fb);
    fb.Finish(entries);

    auto detached = std::make_unique<flatbuffers::DetachedBuffer>(std::move(fb.Release()));
    return packBuffer(std::move(detached));
}
/// Add a script in the catalog
extern "C" FFIResult* dashql_catalog_load_script(dashql::Catalog* catalog, dashql::Script* script, size_t rank) {
    auto status = catalog->LoadScript(*script, rank);
    if (status != buffers::status::StatusCode::OK) {
        return packError(status);
    }
    return packOK();
}
/// Drop entry in the catalog
extern "C" void dashql_catalog_drop_script(dashql::Catalog* catalog, dashql::Script* script) {
    catalog->DropScript(*script);
}
/// Add a descriptor pool to the catalog
extern "C" FFIResult* dashql_catalog_add_descriptor_pool(dashql::Catalog* catalog, size_t external_id, size_t rank) {
    auto status = catalog->AddDescriptorPool(external_id, rank);
    if (status != buffers::status::StatusCode::OK) {
        return packError(status);
    }
    return packOK();
}
/// Drop a descriptor pool from the catalog
extern "C" void dashql_catalog_drop_descriptor_pool(dashql::Catalog* catalog, size_t external_id) {
    catalog->DropDescriptorPool(external_id);
}
/// Add schema descriptor to a catalog
extern "C" FFIResult* dashql_catalog_add_schema_descriptor(dashql::Catalog* catalog, size_t external_id,
                                                           const void* data_ptr, size_t data_size) {
    std::unique_ptr<const std::byte[]> descriptor_buffer{static_cast<const std::byte*>(data_ptr)};
    std::span<const std::byte> descriptor_data{descriptor_buffer.get(), data_size};
    auto status = catalog->AddSchemaDescriptor(external_id, descriptor_data, std::move(descriptor_buffer), data_size);
    if (status != buffers::status::StatusCode::OK) {
        return packError(status);
    }
    return packOK();
}
/// Add schema descriptors to a catalog
extern "C" FFIResult* dashql_catalog_add_schema_descriptors(dashql::Catalog* catalog, size_t external_id,
                                                            const void* data_ptr, size_t data_size) {
    std::unique_ptr<const std::byte[]> descriptor_buffer{static_cast<const std::byte*>(data_ptr)};
    std::span<const std::byte> descriptor_data{descriptor_buffer.get(), data_size};
    auto status = catalog->AddSchemaDescriptors(external_id, descriptor_data, std::move(descriptor_buffer), data_size);
    if (status != buffers::status::StatusCode::OK) {
        return packError(status);
    }
    return packOK();
}

extern "C" FFIResult* dashql_catalog_get_statistics(dashql::Catalog* catalog) {
    auto stats = catalog->GetStatistics();

    // Pack the catalog statistics
    flatbuffers::FlatBufferBuilder fb;
    fb.Finish(buffers::catalog::CatalogStatistics::Pack(fb, stats.get()));

    // Return the buffer
    auto detached = std::make_unique<flatbuffers::DetachedBuffer>(std::move(fb.Release()));
    return packBuffer(std::move(detached));
}

/// Create a script registry
extern "C" FFIResult* dashql_script_registry_new() { return packPtr(std::make_unique<dashql::ScriptRegistry>()); }

/// Clear a registry
extern "C" void dashql_script_registry_clear(dashql::ScriptRegistry* registry) { registry->Clear(); }

/// Load a script
extern "C" FFIResult* dashql_script_registry_add_script(dashql::ScriptRegistry* registry, dashql::Script* script) {
    auto status = registry->AddScript(*script);
    if (status != buffers::status::StatusCode::OK) {
        return packError(status);
    }
    return packOK();
}

/// Drop a script
extern "C" void dashql_script_registry_drop_script(dashql::ScriptRegistry* registry, dashql::Script* script) {
    registry->DropScript(*script);
}

/// Lookup a column ref
extern "C" FFIResult* dashql_script_registry_find_column(dashql::ScriptRegistry* registry, size_t table_context_id,
                                                         size_t table_object_id, size_t column_idx,
                                                         ssize_t target_catalog_version) {
    ExternalObjectID table_id{static_cast<uint32_t>(table_context_id), static_cast<uint32_t>(table_object_id)};
    auto column_id = QualifiedCatalogObjectID::TableColumn(table_id, column_idx);

    flatbuffers::FlatBufferBuilder fb;
    auto version = target_catalog_version < 0 ? std::nullopt : std::optional{target_catalog_version};
    auto templates = registry->FindColumnInfo(fb, column_id, version);
    fb.Finish(templates);
    auto detached = std::make_unique<flatbuffers::DetachedBuffer>(std::move(fb.Release()));
    return packBuffer(std::move(detached));
}

#ifdef WASM
extern "C" int main() { return 0; }
#endif
