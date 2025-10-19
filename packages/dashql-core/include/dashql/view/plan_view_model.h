#pragma once

#include <memory>
#include <variant>

#include "dashql/buffers/index_generated.h"
#include "dashql/utils/chunk_buffer.h"
#include "dashql/utils/intrusive_list.h"
#include "rapidjson/document.h"

namespace dashql {

class PlanViewModel {
   public:
    /// An child attribute in another object
    struct MemberInObject {
        /// The attribute name
        std::string_view attribute;
        /// Constructor
        MemberInObject(std::string_view name) : attribute(name) {}
    };
    /// An entry in an array
    struct EntryInArray {
        /// The index in the array
        size_t index;
        /// Constructor
        EntryInArray(size_t index) : index(index) {}
    };
    /// A path component
    using PathComponent = std::variant<MemberInObject, EntryInArray, std::monostate>;
    /// The node
    struct ParsedOperatorNode : public IntrusiveListNode {
        /// The parent child type
        std::vector<PathComponent> parent_child_path;
        /// The json value
        rapidjson::Value& json_value;
        /// The operator type
        std::string_view operator_type;
        /// The child operators
        IntrusiveList<IntrusiveListNode> child_operators;
        /// The operator attributes
        std::vector<std::pair<std::string_view, std::reference_wrapper<const rapidjson::Value>>> operator_attributes;

        /// Constructor
        ParsedOperatorNode(std::vector<PathComponent> parent_child_path, rapidjson::Value& json_value,
                           std::string_view operator_type, IntrusiveList<IntrusiveListNode> children)
            : parent_child_path(std::move(parent_child_path)),
              json_value(json_value),
              operator_type(operator_type),
              child_operators(children) {}
    };
    /// A sealed operator node
    struct SealedOperatorNode {
        /// The parent child type
        std::vector<PathComponent> parent_child_path;
        /// The json value
        rapidjson::Value& json_value;
        /// The operator attributes
        std::vector<std::pair<std::string_view, std::reference_wrapper<const rapidjson::Value>>> operator_attributes;
        /// The child operators
        std::span<SealedOperatorNode> child_operators;

        /// Move Constructor
        SealedOperatorNode(const SealedOperatorNode& op);
        /// Constructor
        SealedOperatorNode(ParsedOperatorNode&& op);
    };

   protected:
    /// The input json plan.
    /// We use destructive parsing, so this will not be valid json
    std::string input;
    /// The document
    rapidjson::Document document;
    /// The operator buffer
    ChunkBuffer<ParsedOperatorNode> parsed_operators;
    /// The root operator
    std::vector<std::reference_wrapper<ParsedOperatorNode>> root_operators;
    /// The sealed operators
    std::vector<SealedOperatorNode> operators;

   public:
    /// Constructor
    PlanViewModel();

    /// Parse a hyper plan
    buffers::status::StatusCode ParseHyperPlan(std::string plan);
    /// Seal the buffer and operators
    void FinishOperators();
};

}  // namespace dashql
