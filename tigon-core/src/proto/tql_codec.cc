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
            // Viz statement
            [&](std::unique_ptr<tql::VizStatement>& viz) {
                auto name = builder.CreateString(viz->name.data(), viz->name.length());
                proto::TQLVizStatementBuilder stmtBuilder{builder};
                stmtBuilder.add_viz_name(name);
                // TODO viz fields
                statements.push_back(stmtBuilder.Finish().Union());
                statementTypes.push_back(static_cast<uint8_t>(proto::TQLStatement::TQLVizStatement));
            },

            // Extract statement
            [&](std::unique_ptr<tql::ExtractStatement>& extract) {
                auto name = builder.CreateString(extract->name.data(), extract->name.length());
                proto::TQLExtractStatementBuilder stmtBuilder{builder};
                stmtBuilder.add_extract_name(name);
                // TODO extract method
                statements.push_back(stmtBuilder.Finish().Union());
                statementTypes.push_back(static_cast<uint8_t>(proto::TQLStatement::TQLExtractStatement));
            },

            // Load statement
            [&](std::unique_ptr<tql::LoadStatement>& load) {
                auto name = builder.CreateString(load->name.data(), load->name.length());
                proto::TQLLoadStatementBuilder stmtBuilder{builder};
                stmtBuilder.add_data_name(name);
                // TODO load method
                statements.push_back(stmtBuilder.Finish().Union());
                statementTypes.push_back(static_cast<uint8_t>(proto::TQLStatement::TQLLoadStatement));
            },

            // Parameter declaration
            [&](std::unique_ptr<tql::ParameterDeclaration>& param) {
                auto name = builder.CreateString(param->name.data(), param->name.length());
                proto::TQLParameterDeclarationBuilder stmtBuilder{builder};
                stmtBuilder.add_parameter_name(name);
                // TODO load method
                statements.push_back(stmtBuilder.Finish().Union());
                statementTypes.push_back(static_cast<uint8_t>(proto::TQLStatement::TQLParameterDeclaration));
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
