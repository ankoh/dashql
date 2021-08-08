// Copyright (c) 2020 The DashQL Authors

import Immutable from 'immutable';
import { Program } from './program';
import { ProgramInstance } from './program_instance';
import * as proto from '@dashql/proto';

export class Plan {
    /// The program
    public readonly programInstance: ProgramInstance;
    /// The module
    public readonly buffer: proto.analyzer.Plan;

    /// Constructor
    public constructor(program_instance: ProgramInstance, plan: proto.analyzer.Plan = new proto.analyzer.Plan()) {
        this.programInstance = program_instance;
        this.buffer = plan;
    }

    /// Access the program
    public get program(): Program {
        return this.programInstance.program;
    }
    /// Access the parameters
    public get input_values(): Immutable.List<any> {
        return this.programInstance.inputValues;
    }
    /// Access the task graph
    public get task_graph(): proto.task.TaskGraph | null {
        return this.buffer.taskGraph();
    }

    /// Iterate setup tasks
    public iterateSetupTasks(fn: (idx: number, node: proto.task.SetupTask) => void): void {
        const graph = this.buffer.taskGraph();
        if (!graph) return;
        const count = graph.setupTasksLength();
        const tmp = new proto.task.SetupTask();
        for (let i = 0; i < count; ++i) {
            fn(i, graph.setupTasks(i, tmp)!);
        }
    }
    /// Iterate setup tasks in reverse order
    public iterateSetupTasksReverse(fn: (idx: number, node: proto.task.SetupTask) => void): void {
        const graph = this.buffer.taskGraph();
        if (!graph) return;
        const count = graph.setupTasksLength();
        const tmp = new proto.task.SetupTask();
        for (let i = 0; i < count; ++i) {
            const ri = count - i - 1;
            fn(ri, graph.setupTasks(ri, tmp)!);
        }
    }
    /// Iterate program tasks
    public iterateProgramTasks(fn: (idx: number, node: proto.task.ProgramTask) => void): void {
        const graph = this.buffer.taskGraph();
        if (!graph) return;
        const count = graph.programTasksLength();
        const tmp = new proto.task.ProgramTask();
        for (let i = 0; i < count; ++i) {
            fn(i, graph.programTasks(i, tmp)!);
        }
    }

    /// Map program tasks
    public mapProgramTasks<T>(fn: (idx: number, node: proto.task.ProgramTask) => T): T[] {
        const graph = this.buffer.taskGraph();
        if (!graph) return [];
        const mapped: T[] = [];
        mapped.length = graph.programTasksLength();
        this.iterateProgramTasks((i, n) => {
            mapped[i] = fn(i, n);
        });
        return mapped;
    }

    /// Map setup tasks
    public mapSetupTasks<T>(fn: (idx: number, node: proto.task.SetupTask) => T): T[] {
        const graph = this.buffer.taskGraph();
        if (!graph) return [];
        const mapped: T[] = [];
        mapped.length = graph.programTasksLength();
        this.iterateSetupTasks((i, n) => {
            mapped[i] = fn(i, n);
        });
        return mapped;
    }
}
