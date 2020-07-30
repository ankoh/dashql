//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include "tigon/common/variant.h"
#include "tigon/proto/tql_codec.h"

namespace protobuf = google::protobuf;

namespace tigon {
    void setLocation(tigon::proto::tql::Location* destination, tigon::tql::Location& source) {
        auto* begin = destination->mutable_begin();
        auto* end = destination->mutable_end();

        begin->set_line(source.begin.line);
        begin->set_column(source.begin.column);

        end->set_line(source.end.line);
        end->set_column(source.end.column);
    }

    void setString(tigon::proto::tql::String* destination, tigon::tql::String& source) {
        setLocation(destination->mutable_location(), source.location);
        destination->set_string(source.string.data(), source.string.size());
    }

    /// Write the tql program
    proto::tql::Module* encodeTQLModule(protobuf::Arena& arena, tql::Module& module) {
        auto* result = protobuf::Arena::CreateMessage<proto::tql::Module>(&arena);
        auto* statements = result->mutable_statements();
        auto* errors = result->mutable_errors();

        // Encode statements
        for (auto& statement : module.statements) {
            std::visit(overload{// Parameter declaration
                                [&](tql::ParameterDeclaration& parameter) {
                                    auto* next = statements->Add()->mutable_parameter();

                                    // Set location
                                    setLocation(next->mutable_location(), parameter.location);

                                    // Set name
                                    setString(next->mutable_name(), parameter.name);

                                    // Set type
                                    auto* type = next->mutable_type();
                                    setLocation(type->mutable_location(), parameter.type.location);
                                    type->set_type(static_cast<proto::tql::ParameterTypeType>(parameter.type.type));
                                },

                                // Load statement
                                [&](tql::LoadStatement& load) {
                                    auto* next = statements->Add()->mutable_load();

                                    // Set location
                                    setLocation(next->mutable_location(), load.location);

                                    // Set name
                                    setString(next->mutable_name(), load.name);

                                    // Set method
                                    std::visit(overload{[&](tql::LoadStatement::HTTPLoader& loader) {
                                                            // TODO
                                                        },
                                                        [&](tql::LoadStatement::FileLoader& loader) {
                                                            // TODO
                                                        }},
                                               load.method);
                                },

                                // Extract statement
                                [&](tql::ExtractStatement& extract) {
                                    auto* next = statements->Add()->mutable_extract();

                                    // Set location
                                    setLocation(next->mutable_location(), extract.location);

                                    // Set name
                                    setString(next->mutable_name(), extract.name);

                                    // Set data name
                                    setString(next->mutable_data_name(), extract.data_name);

                                    // Set method
                                    // TODO
                                },

                                // SQL statement
                                [&](tql::QueryStatement& query) {
                                    auto* next = statements->Add()->mutable_query();

                                    // Set location
                                    setLocation(next->mutable_location(), query.location);

                                    // Set name
                                    if (query.name) {
                                        setString(next->mutable_name(), *query.name);
                                    }

                                    // Set query text
                                    setString(next->mutable_query_text(), query.query_text);
                                },

                                // Viz statement
                                [&](tql::VizStatement& viz) {
                                    std::cout << "Viz name: " << viz.name.string << std::endl;

                                    auto* next = statements->Add()->mutable_viz();

                                    // Set location
                                    setLocation(next->mutable_location(), viz.location);

                                    // Set name
                                    setString(next->mutable_name(), viz.name);

                                    // Set query name
                                    setString(next->mutable_query_name(), viz.query_name);

                                    // Set viz type
                                    auto* viz_type = next->mutable_viz_type();
                                    setLocation(viz_type->mutable_location(), viz.viz_type.location);
                                    viz_type->set_type(static_cast<proto::tql::VizTypeType>(viz.viz_type.type));
                                }},
                       statement);
        }

        // Encode errors
        for (auto& error : module.errors) {
            auto* next = errors->Add();

            // Set location
            setLocation(next->mutable_location(), error.location);

            // Set message
            next->set_message(error.message.data(), error.message.size());
        }

        return result;
    }
} // namespace tigon
