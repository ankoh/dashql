//---------------------------------------------------------------------------
// DashQL
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include "dashql/common/variant.h"
#include "dashql/proto/tql_codec.h"

namespace protobuf = google::protobuf;

namespace dashql {
    void setLocation(dashql::proto::tql::Location* destination, dashql::tql::Location& source) {
        auto* begin = destination->mutable_begin();
        auto* end = destination->mutable_end();

        begin->set_line(source.begin.line);
        begin->set_column(source.begin.column);

        end->set_line(source.end.line);
        end->set_column(source.end.column);
    }

    void setString(dashql::proto::tql::String* destination, dashql::tql::String& source) {
        setLocation(destination->mutable_location(), source.location);
        destination->set_string(std::string(source.string));
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

                                    // Set label
                                    setString(next->mutable_label(), parameter.label);

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
                                                            auto* file = next->mutable_file();

                                                            // Set location
                                                            setLocation(file->mutable_location(), loader.location);

                                                            // Set variable
                                                            auto* variable = file->mutable_variable();
                                                            setLocation(variable->mutable_location(), loader.variable.location);
                                                            setString(variable->mutable_name(), loader.variable.name);
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
                                    std::visit(overload{
                                                   [&](tql::ExtractStatement::CSVExtract& extractor) {
                                                       auto* csv = next->mutable_csv();

                                                       setLocation(csv->mutable_location(), extractor.location);
                                                   },
                                                   [&](tql::ExtractStatement::JSONPathExtract& extractor) {
                                                       auto* json = next->mutable_json();

                                                       setLocation(json->mutable_location(), extractor.location);
                                                   },
                                               },
                                               extract.method);
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
} // namespace dashql
