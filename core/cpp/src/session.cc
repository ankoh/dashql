#include "dashql/session.h"

#include "dashql/parser/parser_driver.h"
#include "dashql/proto/session_generated.h"
#include "dashql/proto/syntax_generated.h"

using namespace dashql;
namespace fb = flatbuffers;
namespace sx = proto::syntax;

namespace dashql {

// Drive actions
fb::Offset<ActionGraph> Session::DeriveActions(fb::FlatBufferBuilder& builder, const ExecutableProgram& prev,
                                               const Program& next) {
//    auto* prev_program = prev.program();
//    auto* prev_nodes = prev_program->nodes();
//    auto* prev_statements = prev_program->statements();
//    auto* prev_action_graph = prev.action_graph();
//    auto* prev_actions = prev_action_graph->plan();

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
