#include "dashql/test/action_test_encoder.h"

#include <cstdint>
#include <iostream>
#include <regex>
#include <sstream>
#include <stack>
#include <unordered_set>

#include "c4/yml/std/string.hpp"
#include "c4/yml/yml.hpp"
#include "dashql/proto/action_generated.h"
#include "dashql/proto/syntax_dashql_generated.h"
#include "dashql/proto/syntax_generated.h"
#include "dashql/proto/syntax_sql_generated.h"
#include "ryml.hpp"
#include "ryml_std.hpp"

namespace dashql {
namespace parser {

void EncodeActionTest(ryml::NodeRef root, const ProgramInstance& program, const proto::action::ActionGraphT& graph) {
    auto& tree = *root.tree();
    root |= ryml::MAP;

    auto setup_action_type_tt = proto::action::SetupActionTypeTypeTable();
    auto program_action_type_tt = proto::action::ProgramActionTypeTypeTable();
    auto action_status_tt = proto::action::ActionStatusTypeTable();

    root["text"] << std::string{program.program_text()};

    auto setup_actions = root["setup"];
    setup_actions |= ryml::SEQ;
    for (auto& action: graph.setup_actions) {
        auto s = setup_actions.append_child();
        s |= ryml::MAP;
        s["action_type"] << c4::to_csubstr(setup_action_type_tt->names[static_cast<uint16_t>(action->action_type)]);
        s["action_status"] << c4::to_csubstr(action_status_tt->names[static_cast<uint16_t>(action->action_status->status_code())]);
        s["target_id"] << action->target_id;
        s["target_name_qualified"] << action->target_name_qualified;
        s["target_name_short"] << action->target_name_short;
    }

    auto program_actions = root["program"];
    program_actions |= ryml::SEQ;
    for (auto& action: graph.program_actions) {
        auto p = program_actions.append_child();
        p["action_type"] << c4::to_csubstr(program_action_type_tt->names[static_cast<uint16_t>(action->action_type)]);
        p["action_status"] << c4::to_csubstr(action_status_tt->names[static_cast<uint16_t>(action->action_status->status_code())]);
        auto depends_on = p["depends_on"];
        depends_on |= ryml::SEQ;
        for (auto v: action->depends_on) {
            depends_on.append_child() << v;
        }
        auto required_for = p["required_for"];
        required_for |= ryml::SEQ;
        for (auto v: action->required_for) {
            required_for.append_child() << v;
        }
        p["origin_statement"] << action->origin_statement;
        p["target_id"] << action->target_id;
        p["target_name_qualified"] << action->target_name_qualified;
        p["target_name_short"] << action->target_name_short;
        p["script"] << action->script;
    }
}

}  // namespace parser
}  // namespace dashql
