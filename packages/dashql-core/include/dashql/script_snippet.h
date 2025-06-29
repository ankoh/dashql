#include <string_view>
#include <vector>

#include "dashql/script_signature.h"
#include "dashql/text/names.h"

namespace dashql {

struct ScriptSnippet {
    /// The snippet text
    std::string_view text;
    /// The names in the scripts name registry.
    std::vector<std::string_view> names;
    /// The ast nodes
    std::vector<buffers::parser::Node> nodes;
    /// The root node id
    size_t root_node_id = 0;
    /// The semantic node markers
    std::vector<buffers::analyzer::SemanticNodeMarkerType> node_markers;

    // Compute the signature
    size_t ComputeSignature(bool skip_names_and_literals) const;
    /// Pack the script snippet
    flatbuffers::Offset<buffers::snippet::ScriptSnippet> Pack(flatbuffers::FlatBufferBuilder& builder) const;

    /// Extract a script snipped from an AST
    static ScriptSnippet Extract(std::string_view text, std::span<const buffers::parser::Node> ast,
                                 std::span<const buffers::analyzer::SemanticNodeMarkerType> ast_markers, size_t node_id,
                                 const NameRegistry& names);
};

}  // namespace dashql
