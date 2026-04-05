#include "dashql/api.h"

#include <flatbuffers/buffer.h>
#include <flatbuffers/detached_buffer.h>
#include <flatbuffers/flatbuffer_builder.h>

#include <span>

#include "dashql/analyzer/completion.h"
#include "dashql/buffers/index_generated.h"
#include "dashql/catalog.h"
#include "dashql/catalog_object.h"
#include "dashql/exception.h"
#include "dashql/script.h"
#include "dashql/version.h"
#include "dashql/view/plan_view_model.h"

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

template <typename T> static void packPtr(FFIResult* result, std::unique_ptr<T> ptr) {
    auto raw_ptr = ptr.release();
    result->data_ptr = nullptr;
    result->data_length = 0;
    result->owner_ptr = raw_ptr;
    result->owner_deleter = [](void* p) { delete reinterpret_cast<T*>(p); };
}

static void packBuffer(FFIResult* result, std::unique_ptr<flatbuffers::DetachedBuffer> detached) {
    result->data_ptr = detached->data();
    result->data_length = detached->size();
    result->owner_ptr = detached.release();
    result->owner_deleter = [](void* buffer) { delete reinterpret_cast<flatbuffers::DetachedBuffer*>(buffer); };
}

/// Get the DashQL version
extern "C" DashQLVersion* dashql_version() { return &dashql::VERSION; }

/// Allocate memory
extern "C" std::byte* dashql_malloc(size_t length) { return new std::byte[length]; }
/// Delete memory
extern "C" void dashql_free(const void* buffer) { delete[] reinterpret_cast<const std::byte*>(buffer); }

/// Delete an owner by calling its deleter (for stack-allocated FFIResult)
extern "C" void dashql_delete_owner(void* owner_ptr, void (*owner_deleter)(void*)) {
    if (owner_deleter && owner_ptr) {
        owner_deleter(owner_ptr);
    }
}

/// Create a script
extern "C" void dashql_script_new(FFIResult* result, dashql::Catalog* catalog) {
    if (!catalog) {
        throw Exception(buffers::status::StatusCode::CATALOG_NULL);
    }
    // Construct the script
    auto script = std::make_unique<Script>(*catalog);
    packPtr(result, std::move(script));
}
/// Get the catalog entry id
extern "C" uint32_t dashql_script_get_catalog_entry_id(dashql::Script* script) { return script->GetCatalogEntryId(); }
/// Insert char at a position
extern "C" void dashql_script_insert_char_at(Script* script, size_t offset, uint32_t unicode) {
    script->InsertCharAt(offset, unicode);
}
/// Insert text at a position
extern "C" void dashql_script_insert_text_at(Script* script, size_t offset, const char* text_ptr, size_t text_length) {
    std::unique_ptr<const char[]> text_buffer{text_ptr};
    std::string_view text{text_ptr, text_length};
    script->InsertTextAt(offset, text);
}
/// Replace text in a script
extern "C" void dashql_script_replace_text(dashql::Script* script, const char* text_ptr, size_t text_length) {
    std::unique_ptr<const char[]> text_buffer{text_ptr};
    std::string_view text{text_ptr, text_length};
    script->ReplaceText(text);
}
/// Erase a text range
extern "C" void dashql_script_erase_text_range(Script* script, size_t offset, size_t count) {
    script->EraseTextRange(offset, count);
}
/// Get the script content as string
extern "C" void dashql_script_to_string(FFIResult* result, Script* script) {
    auto text = std::make_unique<std::string>(script->ToString());
    result->data_ptr = text->data();
    result->data_length = text->length();
    result->owner_ptr = text.release();
    result->owner_deleter = [](void* buffer) { delete reinterpret_cast<std::string*>(buffer); };
}

/// Scan a script
extern "C" void dashql_script_scan(Script* script) { script->Scan(); }
/// Parse a script
extern "C" void dashql_script_parse(Script* script) { script->Parse(); }
/// Analyze a script
extern "C" void dashql_script_analyze(Script* script, bool parse_if_outdated) { script->Analyze(parse_if_outdated); }
/// Format a script
extern "C" void dashql_script_format(FFIResult* result, Script* script, size_t dialect, size_t mode, size_t max_width,
                                     size_t indentation_width, bool debug_mode, Catalog* catalog) {
    buffers::formatting::FormattingConfigT config;
    config.dialect = static_cast<dashql::buffers::formatting::FormattingDialect>(dialect);
    config.mode = static_cast<dashql::buffers::formatting::FormattingMode>(mode);
    config.max_width = max_width;
    config.indentation_width = indentation_width;
    config.debug_mode = debug_mode;

    // Format the script
    auto text = script->Format(config);

    std::optional<Catalog> ad_hoc_catalog;
    if (catalog == nullptr) {
        catalog = &ad_hoc_catalog.emplace();
    }

    // Construct a new script from the text
    auto new_script = std::make_unique<Script>(*catalog);
    new_script->InsertTextAt(0, text);

    // Pack the script pointer
    packPtr(result, std::move(new_script));
}

/// Get the parsed script
extern "C" void dashql_script_get_scanned(FFIResult* result, Script* script) {
    if (script->scanned_script == nullptr) {
        throw Exception(buffers::status::StatusCode::SCRIPT_NOT_ANALYZED);
    }

    // Pack a parsed script
    flatbuffers::FlatBufferBuilder fb;
    fb.Finish(script->scanned_script->Pack(fb));
    auto detached = std::make_unique<flatbuffers::DetachedBuffer>(fb.Release());
    packBuffer(result, std::move(detached));
}

/// Get the parsed script
extern "C" void dashql_script_get_parsed(FFIResult* result, Script* script) {
    if (script->parsed_script == nullptr) {
        throw Exception(buffers::status::StatusCode::SCRIPT_NOT_ANALYZED);
    }

    // Pack a parsed script
    flatbuffers::FlatBufferBuilder fb;
    fb.Finish(script->parsed_script->Pack(fb));
    auto detached = std::make_unique<flatbuffers::DetachedBuffer>(fb.Release());
    packBuffer(result, std::move(detached));
}

/// Get the analyzed script
extern "C" void dashql_script_get_analyzed(FFIResult* result, Script* script) {
    if (script->analyzed_script == nullptr) {
        throw Exception(buffers::status::StatusCode::SCRIPT_NOT_ANALYZED);
    }

    // Pack a parsed script
    flatbuffers::FlatBufferBuilder fb;
    fb.Finish(script->analyzed_script->Pack(fb));
    auto detached = std::make_unique<flatbuffers::DetachedBuffer>(fb.Release());
    packBuffer(result, std::move(detached));
}

/// Get catalog entry id of the script
extern "C" uint32_t dashql_script_get_catalog_entry_id(dashql::Script* script);

/// Move the cursor to a script at a position
extern "C" void dashql_script_move_cursor(FFIResult* result, dashql::Script* script, size_t text_offset) {
    auto cursor = script->MoveCursor(text_offset);

    // Pack the cursor info
    flatbuffers::FlatBufferBuilder fb;
    fb.Finish(cursor->Pack(fb));

    // Store the buffer
    auto detached = std::make_unique<flatbuffers::DetachedBuffer>(fb.Release());
    packBuffer(result, std::move(detached));
}

extern "C" void dashql_script_complete_at_cursor(FFIResult* result, dashql::Script* script, size_t limit,
                                                 dashql::ScriptRegistry* registry) {
    auto completion = script->CompleteAtCursor(limit, registry);

    // Pack the completion
    flatbuffers::FlatBufferBuilder fb;
    fb.Finish(completion->Pack(fb));

    // Store the buffer
    auto detached = std::make_unique<flatbuffers::DetachedBuffer>(fb.Release());
    packBuffer(result, std::move(detached));
}

extern "C" void dashql_script_select_completion_candidate_at_cursor(FFIResult* result, dashql::Script* script,
                                                                    const void* prev_completion_bytes,
                                                                    size_t candidate_id) {
    // Read the previous completion
    auto* prev_completion = flatbuffers::GetRoot<buffers::completion::Completion>(prev_completion_bytes);

    // Select the completion candidate
    flatbuffers::FlatBufferBuilder fb;
    auto completion = script->SelectCompletionCandidateAtCursor(fb, *prev_completion, candidate_id);
    fb.Finish(completion);

    // Store the buffer
    auto detached = std::make_unique<flatbuffers::DetachedBuffer>(fb.Release());
    packBuffer(result, std::move(detached));
}

extern "C" void dashql_script_select_completion_catalog_object_at_cursor(FFIResult* result, dashql::Script* script,
                                                                         const void* prev_completion_bytes,
                                                                         size_t candidate_id,
                                                                         size_t catalog_object_idx) {
    // Read the previous completion
    auto* prev_completion = flatbuffers::GetRoot<buffers::completion::Completion>(prev_completion_bytes);

    // Select the completion candidate
    flatbuffers::FlatBufferBuilder fb;
    auto completion =
        script->SelectCompletionCatalogObjectAtCursor(fb, *prev_completion, candidate_id, catalog_object_idx);
    fb.Finish(completion);

    // Store the buffer
    auto detached = std::make_unique<flatbuffers::DetachedBuffer>(fb.Release());
    packBuffer(result, std::move(detached));
}

extern "C" void dashql_script_get_statistics(FFIResult* result, dashql::Script* script) {
    auto stats = script->GetStatistics();

    // Pack a schema graph
    flatbuffers::FlatBufferBuilder fb;
    fb.Finish(buffers::statistics::ScriptStatistics::Pack(fb, stats.get()));

    // Return the buffer
    auto detached = std::make_unique<flatbuffers::DetachedBuffer>(fb.Release());
    packBuffer(result, std::move(detached));
}

/// Create a catalog
extern "C" void dashql_catalog_new(FFIResult* result) { packPtr(result, std::make_unique<dashql::Catalog>()); }
/// Clear a catalog
extern "C" void dashql_catalog_clear(dashql::Catalog* catalog) { catalog->Clear(); }
/// Get script id
extern "C" bool dashql_catalog_contains_entry_id(dashql::Catalog* catalog, uint32_t entry_id) {
    return catalog->Contains(entry_id);
}
/// Describe all entries
extern "C" void dashql_catalog_describe_entries(FFIResult* result, dashql::Catalog* catalog) {
    flatbuffers::FlatBufferBuilder fb;
    auto entries = catalog->DescribeEntries(fb);
    fb.Finish(entries);

    auto detached = std::make_unique<flatbuffers::DetachedBuffer>(fb.Release());
    packBuffer(result, std::move(detached));
}
/// Describe all entries
extern "C" void dashql_catalog_describe_entries_of(FFIResult* result, dashql::Catalog* catalog, size_t entry_id) {
    flatbuffers::FlatBufferBuilder fb;
    auto entries = catalog->DescribeEntriesOf(fb, entry_id);
    fb.Finish(entries);

    auto detached = std::make_unique<flatbuffers::DetachedBuffer>(fb.Release());
    packBuffer(result, std::move(detached));
}
/// Flatten the catalog
extern "C" void dashql_catalog_flatten(FFIResult* result, dashql::Catalog* catalog) {
    flatbuffers::FlatBufferBuilder fb;
    auto entries = catalog->Flatten(fb);
    fb.Finish(entries);

    auto detached = std::make_unique<flatbuffers::DetachedBuffer>(fb.Release());
    packBuffer(result, std::move(detached));
}
/// Add a script in the catalog
extern "C" void dashql_catalog_load_script(dashql::Catalog* catalog, dashql::Script* script, size_t rank) {
    catalog->LoadScript(*script, rank);
}
/// Drop entry in the catalog
extern "C" void dashql_catalog_drop_script(dashql::Catalog* catalog, dashql::Script* script) {
    catalog->DropScript(*script);
}
/// Add a descriptor pool to the catalog
extern "C" void dashql_catalog_add_descriptor_pool(FFIResult* result, dashql::Catalog* catalog, size_t rank) {
    // Add a descriptor pool
    CatalogEntryID entry_id = 0;
    catalog->AddDescriptorPool(rank, entry_id);

    // Pack the descriptor pool
    flatbuffers::FlatBufferBuilder fb;
    buffers::catalog::CatalogDescriptorPoolBuilder builder{fb};
    builder.add_catalog_entry_id(entry_id);
    auto descriptorOfs = builder.Finish();
    fb.Finish(descriptorOfs);
    auto detached = std::make_unique<flatbuffers::DetachedBuffer>(fb.Release());
    packBuffer(result, std::move(detached));
}
/// Drop a descriptor pool from the catalog
extern "C" void dashql_catalog_drop_descriptor_pool(dashql::Catalog* catalog, size_t external_id) {
    catalog->DropDescriptorPool(external_id);
}
/// Add schema descriptor to a catalog
extern "C" void dashql_catalog_add_schema_descriptor(dashql::Catalog* catalog, size_t external_id, const void* data_ptr,
                                                     size_t data_size) {
    std::unique_ptr<const std::byte[]> descriptor_buffer{static_cast<const std::byte*>(data_ptr)};
    std::span<const std::byte> descriptor_data{descriptor_buffer.get(), data_size};
    catalog->AddSchemaDescriptor(external_id, descriptor_data, std::move(descriptor_buffer), data_size);
}
/// Add schema descriptors to a catalog
extern "C" void dashql_catalog_add_schema_descriptors(dashql::Catalog* catalog, size_t external_id,
                                                      const void* data_ptr, size_t data_size) {
    std::unique_ptr<const std::byte[]> descriptor_buffer{static_cast<const std::byte*>(data_ptr)};
    std::span<const std::byte> descriptor_data{descriptor_buffer.get(), data_size};
    catalog->AddSchemaDescriptors(external_id, descriptor_data, std::move(descriptor_buffer), data_size);
}

extern "C" void dashql_catalog_get_statistics(FFIResult* result, dashql::Catalog* catalog) {
    auto stats = catalog->GetStatistics();

    // Pack the catalog statistics
    flatbuffers::FlatBufferBuilder fb;
    fb.Finish(buffers::catalog::CatalogStatistics::Pack(fb, stats.get()));

    // Return the buffer
    auto detached = std::make_unique<flatbuffers::DetachedBuffer>(fb.Release());
    packBuffer(result, std::move(detached));
}

/// Create a script registry
extern "C" void dashql_script_registry_new(FFIResult* result) {
    packPtr(result, std::make_unique<dashql::ScriptRegistry>());
}

/// Clear a registry
extern "C" void dashql_script_registry_clear(dashql::ScriptRegistry* registry) { registry->Clear(); }

/// Load a script
extern "C" void dashql_script_registry_add_script(dashql::ScriptRegistry* registry, dashql::Script* script) {
    registry->AddScript(*script);
}

/// Drop a script
extern "C" void dashql_script_registry_drop_script(dashql::ScriptRegistry* registry, dashql::Script* script) {
    registry->DropScript(*script);
}

/// Lookup a column ref
extern "C" void dashql_script_registry_find_column(FFIResult* result, dashql::ScriptRegistry* registry,
                                                   size_t table_context_id, size_t table_object_id, size_t column_idx,
                                                   ssize_t target_catalog_version) {
    ExternalObjectID table_id{static_cast<uint32_t>(table_context_id), static_cast<uint32_t>(table_object_id)};
    auto column_id = QualifiedCatalogObjectID::TableColumn(table_id, column_idx);

    flatbuffers::FlatBufferBuilder fb;
    auto version = target_catalog_version < 0 ? std::nullopt : std::optional{target_catalog_version};
    auto templates = registry->FindColumnInfo(fb, column_id, version);
    fb.Finish(templates);
    auto detached = std::make_unique<flatbuffers::DetachedBuffer>(fb.Release());
    packBuffer(result, std::move(detached));
}

/// Create a plan view model
extern "C" void dashql_plan_view_model_new(FFIResult* result) {
    packPtr(result, std::make_unique<dashql::PlanViewModel>());
}
/// Configure a plan view model
extern "C" void dashql_plan_view_model_configure(dashql::PlanViewModel* view_model, double level_height,
                                                 double node_height, double node_margin_horizontal,
                                                 double node_padding_left, double node_padding_right, double icon_width,
                                                 double icon_margin_right, uint32_t max_label_chars,
                                                 double width_per_label_char, double node_min_width) {
    buffers::view::PlanLayoutConfig config;
    config.mutate_level_height(level_height);
    config.mutate_node_height(node_height);
    config.mutate_node_margin_horizontal(node_margin_horizontal);
    config.mutate_node_padding_left(node_padding_left);
    config.mutate_node_padding_right(node_padding_right);
    config.mutate_icon_width(icon_width);
    config.mutate_icon_margin_right(icon_margin_right);
    config.mutate_max_label_chars(max_label_chars);
    config.mutate_width_per_label_char(width_per_label_char);
    config.mutate_node_min_width(node_min_width);
    view_model->Configure(config);
}
/// Load a Hyper plan view model
extern "C" void dashql_plan_view_model_load_hyper_plan(dashql::PlanViewModel* view_model, char* text_ptr,
                                                       size_t text_length) {
    // We're the owner of the text buffer now
    std::unique_ptr<char[]> input_buffer{static_cast<char*>(text_ptr)};
    std::string_view input_view{text_ptr, text_length};

    // Parse the Hyper plan
    view_model->ParseHyperPlan(input_view, std::move(input_buffer));

    // Compute the initial view layout
    view_model->ComputeLayout();
}

/// Reset the plan view model
extern "C" void dashql_plan_view_model_reset(dashql::PlanViewModel* view_model) { view_model->Reset(); }
/// Reset the plan view model execution
extern "C" void dashql_plan_view_model_reset_execution(dashql::PlanViewModel* view_model) {
    view_model->ResetExecution();
}
/// Reset the plan view model
extern "C" void dashql_plan_view_model_pack(FFIResult* result, dashql::PlanViewModel* view_model) {
    flatbuffers::FlatBufferBuilder fb;
    fb.Finish(view_model->Pack(fb));
    auto detached = std::make_unique<flatbuffers::DetachedBuffer>(fb.Release());
    packBuffer(result, std::move(detached));
}
