import type { ActivityRegistry } from "../../core/activity-registry";
import type { AnyActivityDefinition, ActivityName } from "../../core/activities";

export class InMemoryActivityRegistry implements ActivityRegistry {
  private readonly activities = new Map<ActivityName, AnyActivityDefinition>();

  register(def: AnyActivityDefinition): void {
    this.activities.set(def.name, def);
  }

  get(name: ActivityName): AnyActivityDefinition | undefined {
    return this.activities.get(name);
  }

  list(): AnyActivityDefinition[] {
    return Array.from(this.activities.values());
  }

  listByTag(tag: string): AnyActivityDefinition[] {
    return this.list().filter((def) => def.tags?.includes(tag));
  }
}