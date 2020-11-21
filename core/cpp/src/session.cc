#include "dashql/session.h"

#include "dashql/parser/parser_driver.h"
#include "dashql/proto/session_generated.h"

using namespace dashql;
namespace fb = flatbuffers;

namespace dashql {


// In general, the problem of computing the graph-edit distance is NP-complete.
// However, our problem is simpler since we can assume that the statement names stay the same.
//
// Our algorithm works as follows:
//
// We traverse the PREVIOUS action graph in topological order and check for every action whether it is applicable.
//
// An action is applicable iff:
//  1) There exists a statement in the new program with the same qualified name as the actions origin.
//  2) The action itself models precisely what is needed for the new version of the statement.
//  3) All dependencies are applicable.
//
// If an action is applicable, we copy it over to the new action graph and mark it as complete.
// If it is not, we have to check whether it invalidates any previous table.
//
// An action that is not applicable can have two effects:
//  1) If it is only creating a new table, we emit an action to UNDO the effects (i.e. DROP).
//  2) If it is modifying an existing table, we have to backtrack all (transitive) dependencies and invalidate them.
//     We invalidate a previous action by UNDOING its effects and removing the action from the new graph.
//
// Example for not applicable actions:
//  1) SELECT 1 INTO b; DELETE FROM b;
//     If a user removes the delete statement, we have to backtrack that b (and thus the SELECT statment) cannot be carried over.
//  2) SELECT 1 INTO b, SELECT * INTO c FROM b;
//     If a user removes the second statement, we just DROP c.
//
// This will produce a new action graph that will UNDO all actions except for those that can be reused as is.
// Finally, we need to emit new actions for all statements, that were not covered by an applicable action.
//
// XXX we're not parsing insert, delete, update at the moment so we can implement the backwards poisoning later.
//
// Additional notes:
//  - The actions within the action graph are encoded in toplogical order.
//    That allows us to implement the first phase of the algorithm with a linear scan over the previous action array.
//
fb::Offset<ActionGraph> Session::DeriveActions(fb::FlatBufferBuilder& builder, const ExecutableProgram& prev,
                                               const Program& next) {

    proto::action::ActionGraphBuilder graph_builder{builder};
    return graph_builder.Finish();
}

/// Constructor
Session::Session() : database_(), database_connection_(), program_text_(), program_(), action_status_() {
    database_connection_ = database_.Connect();
    program_ = {nullptr, fb::DetachedBuffer()};
}

/// Evaluate a program
ExpectedBufferRef<proto::session::ExecutableProgram> Session::Evaluate(const char* text) {
    std::string_view text_view{text};
    flatbuffers::FlatBufferBuilder builder{text_view.size()};

    // Parse the text
    auto program_ofs = parser::ParserDriver::Parse(builder, text_view);
    auto program_ptr = reinterpret_cast<Program*>(builder.GetCurrentBufferPointer() + builder.GetSize() - program_ofs.o);
    std::optional<fb::Offset<proto::action::ActionGraph>> actions_ofs;
    if (auto expected = std::get<0>(program_)) {
        actions_ofs = DeriveActions(builder, *expected, *program_ptr);
    }

    // Build the executable program
    proto::session::ExecutableProgramBuilder prog_builder{builder};
    prog_builder.add_program(program_ofs);
    if (actions_ofs)
        prog_builder.add_action_graph(*actions_ofs);
    auto prog_ofs = prog_builder.Finish();

    // Finish the buffer
    builder.Finish(prog_ofs);
    auto prog_ptr = fb::GetRoot<proto::session::ExecutableProgram>(builder.GetBufferPointer());
    program_ = {prog_ptr, builder.Release()};
    return {std::get<1>(program_)};
}

/// Update the action status
void Session::UpdateActionStatus(uint32_t id, proto::action::ActionStatus status) {}

}  // namespace dashql
