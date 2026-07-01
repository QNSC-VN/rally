/**
 * ValueObject — equality by value, not identity.
 * Immutable by convention; never hold mutable references.
 */
export abstract class ValueObject<T extends Record<string, unknown>> {
  constructor(protected readonly props: Readonly<T>) {
    Object.freeze(this);
  }

  equals(other: ValueObject<T>): boolean {
    if (other.constructor !== this.constructor) return false;
    return JSON.stringify(this.props) === JSON.stringify(other.props);
  }
}
