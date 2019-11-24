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

    // Encode layout
    auto* layout = protobuf::Arena::CreateMessage<proto::tql::VizLayout>(&arena);
    auto asLengthValue = [&](tql::VizStatement::LengthValue& lv) {
        auto m = protobuf::Arena::CreateMessage<proto::tql::VizLengthValue>(&arena);
        m->set_value(std::get<0>(lv));
        m->set_unit(static_cast<proto::tql::VizLengthUnit>(std::get<1>(lv)));
        return m;
    };
    if (viz.layout.width) {
        auto* w = layout->mutable_width();
        if (auto l = viz.layout.width->wildcard) { w->set_allocated_wildcard(asLengthValue(*l)); }
        if (auto l = viz.layout.width->sm) { w->set_allocated_small(asLengthValue(*l)); }
        if (auto l = viz.layout.width->md) { w->set_allocated_medium(asLengthValue(*l)); }
        if (auto l = viz.layout.width->lg) { w->set_allocated_large(asLengthValue(*l)); }
        if (auto l = viz.layout.width->xl) { w->set_allocated_xlarge(asLengthValue(*l)); }
    }
    if (viz.layout.height) {
        auto* h = layout->mutable_height();
        if (auto l = viz.layout.height->wildcard) { h->set_allocated_wildcard(asLengthValue(*l)); }
        if (auto l = viz.layout.height->sm) { h->set_allocated_small(asLengthValue(*l)); }
        if (auto l = viz.layout.height->md) { h->set_allocated_medium(asLengthValue(*l)); }
        if (auto l = viz.layout.height->lg) { h->set_allocated_large(asLengthValue(*l)); }
        if (auto l = viz.layout.height->xl) { h->set_allocated_xlarge(asLengthValue(*l)); }
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
