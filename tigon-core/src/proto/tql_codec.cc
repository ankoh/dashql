//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include "tigon/proto/tql_codec.h"
#include "tigon/common/variant.h"

namespace fb = flatbuffers;

namespace tigon {
namespace proto {

/// Write the tql program
flatbuffers::Offset<proto::TQLProgram> writeTQLProgram(flatbuffers::FlatBufferBuilder& builder, tql::Program& program) {
    // Encode statements
    std::vector<uint8_t> statementTypes;
    std::vector<flatbuffers::Offset<void>> statements;

    for (auto& statement: program.statements) {
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
            [&](std::unique_ptr<tql::SQLStatement>& display) {
                auto text = builder.CreateString(display->text.data(), display->text.length());
                auto statement = proto::CreateTQLQueryStatement(builder, text);
                statements.push_back(statement.Union());
                statementTypes.push_back(static_cast<uint8_t>(proto::TQLStatement::TQLQueryStatement));
            }
        }, statement);
    }

    // Encode the program
    auto statementTypesOfs = builder.CreateVector(statementTypes);
    auto statementsOfs = builder.CreateVector(statements);
    return proto::CreateTQLProgram(builder, statementTypesOfs, statementsOfs);
}

}  // namespace proto
}  // namespace tigon
