#include <string_view>
#include <vector>

#include "dashql/text/names.h"

namespace dashql {
namespace parser {

class ScriptSnippet {
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

    /// Extract a script snipped from an AST
    ScriptSnippet Extract(std::string_view text, std::span<const buffers::parser::Node> ast,
                          std::span<const buffers::analyzer::SemanticNodeMarkerType> ast_markers, size_t node_id,
                          const NameRegistry& names);

    /// Pack the script snippet
    flatbuffers::Offset<buffers::snippet::ScriptSnippet> Pack(flatbuffers::FlatBufferBuilder& builder);
};

}  // namespace parser
}  // namespace dashql
