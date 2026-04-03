#pragma once

#include <cstddef>
#include <cstdint>

#include "dashql/buffers/index_generated.h"
#include "dashql/catalog.h"
#include "dashql/script.h"
#include "dashql/script_registry.h"
#include "dashql/version.h"
#include "dashql/view/plan_view_model.h"

namespace console {
/// Log a text to the console
void log(std::string_view text);
}  // namespace console

/// Get the DashQL version
extern "C" dashql::DashQLVersion* dashql_version();

/// Allocate memory
extern "C" std::byte* dashql_malloc(size_t length);
/// Delete memory
extern "C" void dashql_free(const void* buffer);

// -----------------------------------------------------------------------------

/// FFI result container (allocated on stack by caller, populated by callee)
/// Used for data-returning functions. Caller allocates FFIResult on stack, passes pointer to function,
/// function fills in the fields, caller reads the fields and calls dashql_delete_owner to clean up.
/// Functions that only perform operations throw exceptions directly without returning FFIResult.
struct FFIResult {
    uint32_t data_length = 0;
    const void* data_ptr = nullptr;
    void* owner_ptr = nullptr;
    void (*owner_deleter)(void*) = nullptr;

    template <typename T> T* CastOwnerPtr() { return static_cast<T*>(owner_ptr); }
};

/// Delete an owner by calling its deleter
extern "C" void dashql_delete_owner(void* owner_ptr, void (*owner_deleter)(void*));

// -----------------------------------------------------------------------------

/// Create a script (fills in result buffer allocated by caller)
extern "C" void dashql_script_new(FFIResult* result, dashql::Catalog* catalog);
/// Get the entry id
extern "C" uint32_t dashql_script_get_catalog_entry_id(dashql::Script* script);
/// Insert char at a position
extern "C" void dashql_script_insert_char_at(dashql::Script* script, size_t offset, uint32_t unicode);
/// Insert text at a position
extern "C" void dashql_script_insert_text_at(dashql::Script* script, size_t offset, const char* text_ptr,
                                             size_t text_length);
/// Replace text in a script
extern "C" void dashql_script_replace_text(dashql::Script* script, const char* text_ptr, size_t text_length);
/// Erase a text range
extern "C" void dashql_script_erase_text_range(dashql::Script* script, size_t offset, size_t count);
/// Get the script content as string
extern "C" void dashql_script_to_string(FFIResult* result, dashql::Script* script);
/// Scan a script (throws exception on error)
extern "C" void dashql_script_scan(dashql::Script* script);
/// Parse a script (throws exception on error)
extern "C" void dashql_script_parse(dashql::Script* script);
/// Analyze a script (throws exception on error)
extern "C" void dashql_script_analyze(dashql::Script* script, bool parse_if_outdated);
/// Get a pretty-printed version of the SQL query
extern "C" void dashql_script_format(FFIResult* result, dashql::Script* script, size_t dialect, size_t mode,
                                     size_t max_width, size_t indentation_width, dashql::Catalog* catalo);
/// Get script id
extern "C" uint32_t dashql_script_get_catalog_entry_id(dashql::Script* script);
/// Get the scanned script
extern "C" void dashql_script_get_scanned(FFIResult* result, dashql::Script* script);
/// Get the parsed script
extern "C" void dashql_script_get_parsed(FFIResult* result, dashql::Script* script);
/// Get the analyzed script
extern "C" void dashql_script_get_analyzed(FFIResult* result, dashql::Script* script);
/// Get script statistics
extern "C" void dashql_script_get_statistics(FFIResult* result, dashql::Script* script);
/// Move the cursor in a script to a position
extern "C" void dashql_script_move_cursor(FFIResult* result, dashql::Script* script, size_t text_offset);
/// Complete at a cursor in the script
extern "C" void dashql_script_complete_at_cursor(FFIResult* result, dashql::Script* script, size_t limit,
                                                 dashql::ScriptRegistry* registry);
/// Complete at a cursor in the script after selecting a candidate of a previous completion
extern "C" void dashql_script_select_completion_candidate_at_cursor(FFIResult* result, dashql::Script* script,
                                                                    const void* completion, size_t candidateId);
/// Complete at a cursor in the script after selecting a catalog object of a previous completion
extern "C" void dashql_script_select_completion_catalog_object_at_cursor(FFIResult* result, dashql::Script* script,
                                                                         const void* completion, size_t candidateId,
                                                                         size_t catalogObjectIdx);

// -----------------------------------------------------------------------------

/// Create a catalog
extern "C" void dashql_catalog_new(FFIResult* result);
/// Clear a catalog
extern "C" void dashql_catalog_clear(dashql::Catalog* catalog);
/// Check if a catalog contains an entry id
extern "C" bool dashql_catalog_contains_entry_id(dashql::Catalog* catalog, uint32_t entry_id);
/// Describe all entries
extern "C" void dashql_catalog_describe_entries(FFIResult* result, dashql::Catalog* catalog);
/// Describe all entries
extern "C" void dashql_catalog_describe_entries_of(FFIResult* result, dashql::Catalog* catalog, size_t external_id);
/// Add a script to the catalog (throws exception on error)
extern "C" void dashql_catalog_load_script(dashql::Catalog* catalog, dashql::Script* script, size_t rank);
/// Drop script from the catalog
extern "C" void dashql_catalog_drop_script(dashql::Catalog* catalog, dashql::Script* script);
/// Add a descriptor pool to the catalog (throws exception on error, returns pool info)
extern "C" void dashql_catalog_add_descriptor_pool(FFIResult* result, dashql::Catalog* catalog, size_t rank);
/// Drop a descriptor pool from the catalog (throws exception on error)
extern "C" void dashql_catalog_drop_descriptor_pool(dashql::Catalog* catalog, size_t external_id);
/// Add schema descriptor to a catalog (throws exception on error)
extern "C" void dashql_catalog_add_schema_descriptor(dashql::Catalog* catalog, size_t external_id, const void* data_ptr,
                                                     size_t data_size);
/// Get catalog statistics
extern "C" void dashql_catalog_get_statistics(FFIResult* result, dashql::Catalog* catalog);

// -----------------------------------------------------------------------------

/// Create a script registry
extern "C" void dashql_script_registry_new(FFIResult* result);
/// Clear a registry
extern "C" void dashql_script_registry_clear(dashql::ScriptRegistry* registry);
/// Load a script (throws exception on error)
extern "C" void dashql_script_registry_add_script(dashql::ScriptRegistry* registry, dashql::Script* script);
/// Drop a script
extern "C" void dashql_script_registry_drop_script(dashql::ScriptRegistry* registry, dashql::Script* script);
/// Lookup column info
extern "C" void dashql_script_registry_find_column(FFIResult* result, dashql::ScriptRegistry* registry,
                                                   size_t table_context_id, size_t table_object_id, size_t column_id,
                                                   ssize_t target_catalog_version);

// -----------------------------------------------------------------------------

/// Create a plan view model
extern "C" void dashql_plan_view_model_new(FFIResult* result);
/// Configure a plan view model
extern "C" void dashql_plan_view_model_configure(dashql::PlanViewModel* view_model, double level_height,
                                                 double node_height, double node_margin_horizontal,
                                                 double node_padding_left, double node_padding_right, double icon_width,
                                                 double icon_margin_right, uint32_t max_label_chars,
                                                 double width_per_label_char, double min_node_width);
/// Load a Hyper plan (throws exception on error)
extern "C" void dashql_plan_view_model_load_hyper_plan(dashql::PlanViewModel* view_model, char* text_ptr,
                                                       size_t text_length);
/// Reset the plan view model
extern "C" void dashql_plan_view_model_reset(dashql::PlanViewModel* view_model);
/// Reset the plan view model execution
extern "C" void dashql_plan_view_model_reset_execution(dashql::PlanViewModel* view_model);
/// Pack the plan view model (throws exception on error)
extern "C" void dashql_plan_view_model_pack(FFIResult* result, dashql::PlanViewModel* view_model);
