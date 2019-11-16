//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include "tigon/proto/tql_codec.h"
#include "tigon/common/variant.h"
#include "flatbuffers/minireflect.h"

namespace fb = flatbuffers;

namespace tigon {
namespace proto {

namespace {

std::string generateName(tql::SQLStatement& stmt) {
    static unsigned id = 0;
    return "query_" + std::to_string(++id);
}

}

/// Write the tql program
flatbuffers::Offset<proto::TQLModule> writeTQLModule(flatbuffers::FlatBufferBuilder& builder, tql::Module& module) {
    // Encode statements
    std::vector<uint8_t> statementTypes;
    std::vector<flatbuffers::Offset<void>> statements;

    for (auto& statement: module.statements) {
        std::visit(overload {
            // Display statement
            [&](std::unique_ptr<tql::DisplayStatement>& display) {
            },

            // Extract statement
            [&](std::unique_ptr<tql::ExtractStatement>& display) {
            },

            // Load statement
            [&](std::unique_ptr<tql::LoadStatement>& display) {
            },

            // Parameter declaration
            [&](std::unique_ptr<tql::ParameterDeclaration>& display) {
            },

            // SQL statement
            [&](std::unique_ptr<tql::SQLStatement>& sql) {
                auto name = sql->name.empty()
                    ? builder.CreateString(generateName(*sql))
                    : builder.CreateString(sql->name.data(), sql->name.length());
                auto text = builder.CreateString(sql->text.data(), sql->text.length());
                proto::TQLQueryStatementBuilder stmtBuilder{builder};
                stmtBuilder.add_query_name(name);
                stmtBuilder.add_query_text(text);
                statements.push_back(stmtBuilder.Finish().Union());
                statementTypes.push_back(static_cast<uint8_t>(proto::TQLStatement::TQLQueryStatement));
            }
        }, statement);
    }

    // Encode the program
    auto statementTypesOfs = builder.CreateVector(statementTypes);
    auto statementsOfs = builder.CreateVector(statements);
    return proto::CreateTQLModule(builder, statementTypesOfs, statementsOfs);
}

}  // namespace proto
}  // namespace tigon
