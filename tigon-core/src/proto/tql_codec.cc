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

auto* createString(protobuf::Arena& arena, std::string_view text) {
    return protobuf::Arena::Create<std::string>(&arena, text);
}

}

/// Write the tql program
proto::tql::Module* writeTQLModule(protobuf::Arena& arena, tql::Module& module) {
    auto* mod = protobuf::Arena::CreateMessage<proto::tql::Module>(&arena);
    auto* stmts = mod->mutable_statements();

    // Encode statements
    for (auto& statement: module.statements) {
        std::visit(overload {
            // Viz statement
            [&](std::unique_ptr<tql::VizStatement>& viz) {
                auto* v = stmts->Add()->mutable_viz();
                v->set_allocated_viz_name(createString(arena, viz->name));
            },

            // Extract statement
            [&](std::unique_ptr<tql::ExtractStatement>& extract) {
                auto* e = stmts->Add()->mutable_extract();
                e->set_allocated_data_name(createString(arena, extract->name));
            },

            // Load statement
            [&](std::unique_ptr<tql::LoadStatement>& load) {
                auto* l = stmts->Add()->mutable_load();
                l->set_allocated_data_name(createString(arena, load->name));
            },

            // Parameter declaration
            [&](std::unique_ptr<tql::ParameterDeclaration>& param) {
                auto* p = stmts->Add()->mutable_parameter();
                p->set_allocated_parameter_name(createString(arena, param->name));
            },

            // SQL statement
            [&](std::unique_ptr<tql::SQLStatement>& sql) {
                auto* q = stmts->Add()->mutable_query();
                q->set_allocated_query_name(createString(arena, sql->name));
                q->set_allocated_query_text(createString(arena, sql->text));
            }
        }, statement);
    }
    return mod;
}

}  // namespace tigon
