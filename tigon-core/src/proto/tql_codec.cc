//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include "tigon/proto/tql_codec.h"
#include "tigon/common/variant.h"

namespace protobuf = google::protobuf;

namespace tigon {
namespace {

auto generateName(tql::QueryStatement& stmt) {
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
                v->set_viz_id(viz->viz_id.data(), viz->viz_id.size());
                v->set_query_id(viz->query_id.data(), viz->query_id.size());
            },

            // Extract statement
            [&](std::unique_ptr<tql::ExtractStatement>& extract) {
                auto* e = stmts->Add()->mutable_extract();
                e->set_extract_id(extract->extract_id.data(), extract->extract_id.size());
            },

            // Load statement
            [&](std::unique_ptr<tql::LoadStatement>& load) {
                auto* l = stmts->Add()->mutable_load();
                l->set_data_id(load->data_id.data(), load->data_id.size());
            },

            // Parameter declaration
            [&](std::unique_ptr<tql::ParameterDeclaration>& param) {
                auto* p = stmts->Add()->mutable_parameter();
                p->set_parameter_id(param->parameter_id.data(), param->parameter_id.size());
            },

            // SQL statement
            [&](std::unique_ptr<tql::QueryStatement>& sql) {
                auto* q = stmts->Add()->mutable_query();
                if (sql->query_id.empty() || sql->query_id == "") {
                    auto name = generateName(*sql);
                    q->set_query_id(name.data(), name.size());                   
                } else {
                    q->set_query_id(sql->query_id.data(), sql->query_id.size());
                }
                q->set_query_text(sql->text.data(), sql->text.size());
            }
        }, statement);
    }
    return mod;
}

}  // namespace tigon
