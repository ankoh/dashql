#pragma once

#include <map>
#include <memory>
#include <string>
#include <string_view>
#include <tuple>
#include <vector>

namespace dashql {
class Catalog;
class Script;
}  // namespace dashql

namespace dashql::shell {

class SessionRelationCatalog {
   public:
    explicit SessionRelationCatalog(Catalog& catalog);
    ~SessionRelationCatalog();

    SessionRelationCatalog(const SessionRelationCatalog&) = delete;
    SessionRelationCatalog& operator=(const SessionRelationCatalog&) = delete;

    void ApplySuccessfulQuery(std::string_view query);

   private:
    struct Relation {
        std::string database_name;
        std::string schema_name;
        std::string relation_name;
        std::vector<std::string> columns;
    };

    using RelationKey = std::tuple<std::string, std::string, std::string>;

    void ReloadCatalogScript();
    std::string RenderCatalog() const;

    Catalog& catalog_;
    std::unique_ptr<Script> parser_script_;
    std::unique_ptr<Script> catalog_script_;
    std::map<RelationKey, Relation> relations_;
};

}  // namespace dashql::shell
