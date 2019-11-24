//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include "tigon/proto/tql_codec.h"
#include "tigon/common/variant.h"

namespace protobuf = google::protobuf;

namespace tigon {
namespace {

/// Generate a query id
auto generateID(tql::QueryStatement& stmt) {
    static unsigned id = 0;
    return "query_" + std::to_string(++id);
}

/// Generate a viz title
auto generateTitle(tql::VizStatement& stmt) {
    static unsigned id = 0;
    auto typeName = stmt.getTypeName();
    return std::string(typeName) + " " + std::to_string(++id);
}

/// Encode a viz statement
tigon::proto::tql::VizStatement* encodeStatement(protobuf::Arena& arena, tql::VizStatement &viz) {
    auto* v = protobuf::Arena::CreateMessage<proto::tql::VizStatement>(&arena);
    v->set_viz_id(viz.viz_id.data(), viz.viz_id.size());
    v->set_viz_type(static_cast<proto::tql::VizType>(viz.type));
    v->set_query_id(viz.query_id.data(), viz.query_id.size());

    // Encode title
    if (viz.title.empty()) {
        v->set_title(generateTitle(viz));
    } else {
        v->set_title(viz.title.data(), viz.title.size());
    }

    // Encode area
    if (viz.area) {
        auto asProtoArea = [&](tql::VizStatement::GridArea& area) {
            auto* a = protobuf::Arena::CreateMessage<proto::tql::VizGridArea>(&arena);
            a->set_column_begin(area.values[0]);
            if (area.length >= 2) { a->set_column_end(area.values[1]); }
            if (area.length >= 3) { a->set_row_begin(area.values[2]); }
            if (area.length >= 4) { a->set_row_end(area.values[3]); }
            return a;
        };
        auto* area = v->mutable_area();
        if (auto a = viz.area->wildcard) { area->set_allocated_wildcard(asProtoArea(*a)); }
        if (auto a = viz.area->sm) { area->set_allocated_small(asProtoArea(*a)); }
        if (auto a = viz.area->md) { area->set_allocated_medium(asProtoArea(*a)); }
        if (auto a = viz.area->lg) { area->set_allocated_large(asProtoArea(*a)); }
        if (auto a = viz.area->xl) { area->set_allocated_xlarge(asProtoArea(*a)); }
        v->set_allocated_area(area);
    }
    return v;
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
                stmts->Add()->set_allocated_viz(encodeStatement(arena, *viz));
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
                if (sql->query_id.empty()) {
                    q->set_query_id(generateID(*sql));                   
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
