#include "dashql/text/names.h"

namespace dashql {

/// Compare two scripts
bool ScriptsAreEqual(std::string_view left_text, std::span<const buffers::parser::Node> left_ast,
                     NameResolver& left_names, std::string_view right_text,
                     std::span<const buffers::parser::Node> right_ast, NameResolver& right_names,
                     bool skip_names_and_literals);

}  // namespace dashql
