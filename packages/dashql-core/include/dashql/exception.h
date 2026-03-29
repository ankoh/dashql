#pragma once

#include <exception>
#include <string>
#include <string_view>

#include "dashql/buffers/index_generated.h"

namespace dashql {

/// Exception thrown by DashQL operations
class Exception : public std::exception {
   public:
    /// The error code (kept for compatibility during transition)
    buffers::status::StatusCode code;

   private:
    /// The error message
    std::string message;

   public:
    /// Constructor with code only
    explicit Exception(buffers::status::StatusCode code) : code(code), message(GetDefaultMessage(code)) {}

    /// Constructor with code and custom message
    Exception(buffers::status::StatusCode code, std::string_view msg) : code(code), message(msg) {}

    /// Get the error message
    const char* what() const noexcept override { return message.c_str(); }

    /// Get the error code
    buffers::status::StatusCode GetCode() const noexcept { return code; }

   private:
    /// Get default message for a status code
    static std::string_view GetDefaultMessage(buffers::status::StatusCode status) {
        switch (status) {
            case buffers::status::StatusCode::CATALOG_NULL:
                return "Catalog is null";
            case buffers::status::StatusCode::CATALOG_MISMATCH:
                return "Catalog is not matching";
            case buffers::status::StatusCode::CATALOG_ID_OUT_OF_SYNC:
                return "Catalog id is out of sync";
            case buffers::status::StatusCode::SCRIPT_NOT_SCANNED:
                return "Script is not scanned";
            case buffers::status::StatusCode::SCRIPT_NOT_PARSED:
                return "Script is not parsed";
            case buffers::status::StatusCode::SCRIPT_NOT_ANALYZED:
                return "Script is not analyzed";
            case buffers::status::StatusCode::CATALOG_SCRIPT_NOT_ANALYZED:
                return "Unanalyzed scripts cannot be added to the catalog";
            case buffers::status::StatusCode::CATALOG_SCRIPT_UNKNOWN:
                return "Script is missing in catalog";
            case buffers::status::StatusCode::CATALOG_DESCRIPTOR_POOL_UNKNOWN:
                return "Schema descriptor pool is not known";
            case buffers::status::StatusCode::CATALOG_DESCRIPTOR_TABLES_NULL:
                return "Schema descriptor field `tables` is null or empty";
            case buffers::status::StatusCode::CATALOG_DESCRIPTOR_TABLE_NAME_EMPTY:
                return "Table name in schema descriptor is null or empty";
            case buffers::status::StatusCode::CATALOG_DESCRIPTOR_TABLE_NAME_COLLISION:
                return "Schema descriptor contains a duplicate table name";
            case buffers::status::StatusCode::COMPLETION_MISSES_CURSOR:
                return "Completion requires a script cursor";
            case buffers::status::StatusCode::COMPLETION_MISSES_SCANNER_TOKEN:
                return "Completion requires a scanner token";
            case buffers::status::StatusCode::COMPLETION_STATE_INCOMPATIBLE:
                return "Completion state is incompatible";
            case buffers::status::StatusCode::COMPLETION_STRATEGY_UNKNOWN:
                return "Completion strategy is unknown";
            case buffers::status::StatusCode::COMPLETION_WITHOUT_CONTINUATION:
                return "Completion has no continuation";
            case buffers::status::StatusCode::COMPLETION_CANDIDATE_INVALID:
                return "Completion candidate is invalid";
            case buffers::status::StatusCode::COMPLETION_CATALOG_OBJECT_INVALID:
                return "Completion catalog object is invalid";
            case buffers::status::StatusCode::COMPLETION_TEMPLATE_INVALID:
                return "Completion template is invalid";
            case buffers::status::StatusCode::EXTERNAL_ID_COLLISION:
                return "Collision on external identifier";
            case buffers::status::StatusCode::VIEWMODEL_INPUT_JSON_PARSER_ERROR:
                return "Failed to parse JSON for ViewModel";
            case buffers::status::StatusCode::OK:
                return "";
        }
        return "Unknown error";
    }
};

}  // namespace dashql
