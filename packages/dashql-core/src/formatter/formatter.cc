#include "dashql/formatter/formatter.h"

namespace dashql {

Formatter::Formatter(std::shared_ptr<ParsedScript> parsed)
    : scanned(*parsed->scanned_script), parsed(*parsed), ast(parsed->GetNodes()), config() {
    node_state.resize(ast.size());
}

rope::Rope Formatter::Format(const FormattingConfig& config) {
    rope::Rope text{128};
    return text;
}

}  // namespace dashql
