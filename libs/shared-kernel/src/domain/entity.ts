/**
 * Base Entity — has identity, equality by ID.
 * Entities with the same ID are considered the same object regardless of attribute values.
 */
export abstract class Entity<TId = string> {
  constructor(protected readonly _id: TId) {}

  get id(): TId {
    return this._id;
  }

  equals(other: Entity<TId>): boolean {
    if (!(other instanceof Entity)) return false;
    return this._id === other._id;
  }
}
