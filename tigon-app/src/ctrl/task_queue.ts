type TaskID = number;
type TaskPriority = number;
type HeapOffset = number;
const INVALID_TASK_ID = 0;

let nextTaskID: number = 0;

class Task {
    public taskID: TaskID;
    public priority: TaskPriority;
    public heapOffset: HeapOffset;

    constructor(prio: TaskPriority) {
        this.taskID = nextTaskID++;
        this.priority = prio;
        this.heapOffset = 0;
    }
}

interface PriorityQueue {
    /// Get the capacity of the queue
    capacity(): number;
    /// Get the number of elements in the queue
    size(): number;
    /// Is the queue empty?
    empty(): boolean;
    /// Push a task to the queue
    push(task: Task): void;
    /// Pop a task from the queue
    pop(): Task | null;
    /// Decrease the priority of a task
    decreasePriority(task: Task, by: number): void;
}

class BinaryHeap implements PriorityQueue {
    protected heap: Uint32Array;
    protected heapSize: number;
    protected tasks: Map<TaskID, Task>;

    public constructor() {
        this.heap = new Uint32Array();
        this.heapSize = 0;
        this.tasks = new Map<TaskID, Task>();
    }

    protected at(i: number): Task | null {
        if (i >= this.heap.length || this.heap[i] === INVALID_TASK_ID) {
            return null;
        }
        return this.tasks.get(this.heap[i])!;
    }

    protected swap(i: number, j: number) {
        let ti = this.at(i);
        let tj = this.at(j);
        if (!ti || !tj) { return; }
        let tmp = this.heap[i];
        this.heap[i] = this.heap[j];
        this.heap[j] = tmp;
        ti.heapOffset = j;
        tj.heapOffset = i;
    }

    protected siftUp(i: number): number {
        let child = this.at(i)!;
        while (i > 0) {
            let parent = this.at(i >> 1)!;
            if (parent.priority > child.priority) {
                this.swap(i, i >> 1);
            } else {
                break;
            }
        }
        return i;
    }

    protected siftDown(i: number): number {
        let parent = this.at(i)!;
        while (true) {
            let child1 = this.at(i * 2 + 0);
            let child2 = this.at(i * 2 + 1);
            if (child1 && parent.priority > child1.priority) {
                this.swap(i, i * 2 + 0);
                parent = child1;
                i = i * 2 + 0;
            } else if (child2 && parent.priority > child2.priority) {
                this.swap(i, i * 2 + 1);
                parent = child2;
                i = i * 2 + 1;
            } else {
                return i;
            }
        }
    }

    public capacity() { return this.heap.length; }
    public size() { return this.heapSize; }
    public empty() { return this.size() === 0; }

    public push(task: Task) {
        let offset = this.heapSize++;
        if (this.heapSize === this.capacity()) {
            let newHeap = new Uint32Array(this.heap.length * 1.5);
            newHeap.set(this.heap);
            this.heap = newHeap;
        }
        task.heapOffset = offset;
        this.heap[offset] = task.taskID;
    }

    public pop(): Task | null {
        if (this.empty()) {
            return null;
        }
        let task = this.at(0)!;
        task.priority = Number.MAX_SAFE_INTEGER;
        let pos = this.siftDown(0);
        this.heap[pos] = INVALID_TASK_ID;
        return task;
    }

    public decreasePriority(task: Task, by: number = 1) {
        task.priority = Math.max(task.priority, by) - by;
        this.siftUp(task.heapOffset);
    }
}


export class TaskController {
    queue: PriorityQueue;

    // Constructor
    constructor() {
        this.queue = new BinaryHeap();
    }
}

export default TaskController;

