#include "dashql/analyzer/stmt/set_stmt.h"

#include <regex>

#include "dashql/analyzer/json_patch.h"
#include "dashql/analyzer/json_writer.h"
#include "dashql/analyzer/program_instance.h"
#include "dashql/common/string.h"
#include "dashql/parser/qualified_name.h"
#include "dashql/proto_generated.h"
#include "rapidjson/ostreamwrapper.h"
#include "rapidjson/prettywriter.h"
#include "rapidjson/stringbuffer.h"
#include "rapidjson/writer.h"

namespace dashql {

SetStatement::SetStatement(ProgramInstance& instance, size_t statement_id, ASTIndex ast)
    : instance_(instance), statement_id_(statement_id), ast_(ast) {}

std::unique_ptr<SetStatement> SetStatement::ReadFrom(ProgramInstance& instance, size_t stmt_id) {
    // clang-format off
    auto& program = instance.program();
    auto& stmt = program.statements[stmt_id];
    static const auto schema = sxm::Element()
        .MatchObject(sx::NodeType::OBJECT_DASHQL_SET);
    // clang-format on

    // Match root
    auto ast = schema.Match(instance, stmt->root_node, 3);
    return std::make_unique<SetStatement>(instance, stmt_id, std::move(ast));
}

/// Print the options as json
void SetStatement::PrintAsJSON(std::ostream& out, bool pretty) const {
    auto& program = instance_.program();
    auto& stmt = program.statements[statement_id_];
    json::DocumentWriter writer{instance_, stmt->root_node, ast_};
    writer.writeAsJSON(out, pretty, true);
}

/// Pack the load statement
flatbuffers::Offset<proto::analyzer::SetStatement> SetStatement::Pack(flatbuffers::FlatBufferBuilder& builder) const {
    auto& program = instance_.program();
    auto& stmt = program.statements[statement_id_];

    // Print the value
    flatbuffers::Offset<flatbuffers::String> value;
    {
        std::stringstream out;
        PrintAsJSON(out, false);
        value = builder.CreateString(out.str());
    }

    // Build load statement
    proto::analyzer::SetStatementBuilder eb{builder};
    eb.add_statement_id(statement_id_);
    eb.add_data(value);
    return eb.Finish();
}

}  // namespace dashql
