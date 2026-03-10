import type { ActivityDefinition, ActivityName, AnyActivityDefinition } from "./activities";

export interface ActivityRegistry {
  register(def: AnyActivityDefinition): void;
  get(name: ActivityName): AnyActivityDefinition | undefined;
  list(): AnyActivityDefinition[];

  listByTag(tag: string): AnyActivityDefinition[];
}