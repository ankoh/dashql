//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include "tigon/proto/tql_codec.h"
#include "tigon/common/variant.h"

namespace protobuf = google::protobuf;

namespace tigon {
namespace {

auto generateName(tql::SQLStatement& stmt) {
    static unsigned id = 0;
    return "query_" + std::to_string(++id);
}

}

/// Write the tql program
proto::tql::Module* encodeTQLModule(protobuf::Arena& arena, tql::Module& module) {
    auto* mod = protobuf::Arena::CreateMessage<proto::tql::Module>(&arena);
    auto* stmts = mod->mutable_statements();

    // Encode statements
    for (auto& statement: module.statements) {
        std::visit(overload {
            // Viz statement
            [&](std::unique_ptr<tql::VizStatement>& viz) {
                auto* v = stmts->Add()->mutable_viz();
                v->set_viz_name(viz->name.data(), viz->name.size());
            },

            // Extract statement
            [&](std::unique_ptr<tql::ExtractStatement>& extract) {
                auto* e = stmts->Add()->mutable_extract();
                e->set_extract_name(extract->name.data(), extract->name.size());
            },

            // Load statement
            [&](std::unique_ptr<tql::LoadStatement>& load) {
                auto* l = stmts->Add()->mutable_load();
                l->set_data_name(load->name.data(), load->name.size());
            },

            // Parameter declaration
            [&](std::unique_ptr<tql::ParameterDeclaration>& param) {
                auto* p = stmts->Add()->mutable_parameter();
                p->set_parameter_name(param->name.data(), param->name.size());
            },

            // SQL statement
            [&](std::unique_ptr<tql::SQLStatement>& sql) {
                auto* q = stmts->Add()->mutable_query();
                if (sql->name.empty() || sql->name == "") {
                    auto name = generateName(*sql);
                    q->set_query_name(name.data(), name.size());                   
                } else {
                    q->set_query_name(sql->name.data(), sql->name.size());
                }
                q->set_query_text(sql->text.data(), sql->text.size());
            }
        }, statement);
    }
    return mod;
}

}  // namespace tigon
