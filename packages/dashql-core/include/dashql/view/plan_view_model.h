#pragma once

#include <memory>

#include "dashql/buffers/index_generated.h"
#include "dashql/utils/chunk_buffer.h"
#include "dashql/utils/intrusive_list.h"
#include "rapidjson/document.h"
#include "rapidjson/rapidjson.h"

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
    struct OperatorNode : public IntrusiveListNode {
        /// The json value
        rapidjson::Value& json_value;
        /// The parent child type
        std::vector<PathComponent> parent_child_path;
        /// The child operators
        IntrusiveList<IntrusiveListNode> children;
        /// The attributes
        std::vector<std::pair<std::string_view, std::reference_wrapper<const rapidjson::Value>>> attributes;

        /// Constructor
        OperatorNode(rapidjson::Value& json_value, std::vector<PathComponent> parent_child_path,
                     IntrusiveList<IntrusiveListNode> children)
            : json_value(json_value), parent_child_path(std::move(parent_child_path)), children(children) {}
    };

    /// The input json plan.
    /// We use destructive parsing, so this will not be valid json
    std::string input;
    /// The document
    rapidjson::Document document;
    /// The operator buffer
    ChunkBuffer<OperatorNode> operator_buffer;
    /// The root operator
    OperatorNode* root_operator;

    /// Constructor
    PlanViewModel();

    /// Parse a hyper plan
    static std::pair<std::unique_ptr<PlanViewModel>, buffers::status::StatusCode> ParseHyperPlan(std::string plan);
};

}  // namespace dashql
