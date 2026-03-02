import type { TaskQueue } from "../modules/task-queue";
import type { Task, TaskLease } from "../shared/tasks";
import type { WorkerId } from "../shared/types";

type QueueName = string;
type LeaseId = string;

export class InMemoryTaskQueue implements TaskQueue {
    private readonly queues = new Map<QueueName, Task[]>();
    private readonly leases = new Map<LeaseId, TaskLease>();

    async enqueue(task: Task): Promise<void> {
        const queueName = task.targetQueue;
        const queue = this.queues.get(queueName) ?? [];
        queue.push(task);
        this.queues.set(queueName, queue);
    }

    async leaseNextTask(workerId: WorkerId, queueName: string, timeoutMs: number): Promise<TaskLease | null> {
        const queue = this.queues.get(queueName);

        if (queue == null || queue.length === 0) {
            return null;
        }

        const task = queue.shift()!;
        const leaseId = `${task.id}:${Date.now()}`;

        const lease: TaskLease = {
            task,
            workerId,
            leaseId,
            leasedAt: new Date().toISOString(),
            leaseTimeoutMs: timeoutMs, 
        };

        this.leases.set(leaseId, lease);
        return lease;
    }

    async completeTask(leaseId: string): Promise<void> {
        const lease = this.leases.get(leaseId);
    }

    async requeueTask(taskId: string): Promise<void> {
        const leaseEntry = Array.from(this.leases.values()).find((lease) => lease.task.id === taskId);

        if (!leaseEntry) {
            return;
        }

        const { task, leaseId } = leaseEntry;
        const queueName = task.targetQueue;
        const queue = this.queues.get(queueName) ?? [];
        queue.push(task);
        this.queues.set(queueName, queue);
        this.leases.delete(leaseId);
    }
}