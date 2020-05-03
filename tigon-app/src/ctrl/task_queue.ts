export type TaskID = number;
export type TaskPriority = number;
type HeapOffset = number;

const INVALID_TASK_ID = 0;
let nextTaskID: number = 0;

/// A task
export class Task {
    /// The task id
    public taskID: TaskID;
    /// The task priority (min-heap)
    public priority: TaskPriority;
    /// The position in the min heap
    public heapOffset: HeapOffset;

    /// The constructor
    public constructor(prio: TaskPriority) {
        this.taskID = nextTaskID++;
        this.priority = prio;
        this.heapOffset = 0;
    }
}

/// A task queue
export class TaskQueue {
    protected heap: Uint32Array;
    protected heapSize: number;
    protected tasks: Map<TaskID, Task>;

    public constructor() {
        this.heap = new Uint32Array();
        this.heapSize = 0;
        this.tasks = new Map<TaskID, Task>();
    }

    /// Get a task at an index
    protected at(i: number): Task | null {
        if (i >= this.heapSize || this.heap[i] === INVALID_TASK_ID) {
            return null;
        }
        return this.tasks.get(this.heap[i])!;
    }

    /// Swap two tasks
    protected swap(i: number, j: number) {
        let ti = this.at(i);
        let tj = this.at(j);
        if (!ti || !tj) {
            return;
        }
        let tmp = this.heap[i];
        this.heap[i] = this.heap[j];
        this.heap[j] = tmp;
        ti.heapOffset = j;
        tj.heapOffset = i;
    }

    /// Siftup task at index
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

    /// Siftdown task at index
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

    /// Get the capacity
    public capacity() {
        return this.heap.length;
    }
    /// Get the size
    public size() {
        return this.heapSize;
    }
    /// Is the heap empty?
    public empty() {
        return this.size() === 0;
    }

    /// Push a task
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

    /// Pop a task
    public pop() {
        if (this.empty()) {
            return;
        }
        let last = this.heapSize - 1;
        this.swap(0, last);
        this.heap[last] = INVALID_TASK_ID;
        --this.heapSize;
        this.siftDown(0);
    }

    /// Get the next task in the queue
    public top(): Task | null {
        return this.at(0);
    }

    /// Decrease the priority of a task
    public decreasePriority(task: Task, by: number = 1) {
        task.priority = Math.max(task.priority, by) - by;
        this.siftUp(task.heapOffset);
    }
}
