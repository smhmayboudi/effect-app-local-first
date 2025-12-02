import { Option } from "effect"

/**
 * Vector Clock implementation for distributed systems.
 * A vector clock is a data structure that provides a causal ordering of events in a distributed system.
 * It maintains a logical clock per node/replica, allowing detection of causality between events.
 */
export class VectorClock {
  /**
   * Creates a new VectorClock instance with optional initial timestamps.
   * @param timestamps - Initial timestamp values for each replica
   */
  constructor(
    public readonly timestamps: Record<string, number> = {}
  ) {}

  /**
   * Creates an empty VectorClock with no timestamps.
   * @returns A new empty VectorClock instance
   */
  static empty(): VectorClock {
    return new VectorClock({})
  }

  /**
   * Increments the timestamp for the specified replica ID.
   * @param replicaId - The identifier of the replica to increment
   * @returns A new VectorClock instance with the incremented timestamp
   */
  increment(replicaId: string): VectorClock {
    const current = this.timestamps[replicaId] || 0
    return new VectorClock({
      ...this.timestamps,
      [replicaId]: current + 1
    })
  }

  /**
   * Compares this VectorClock with another VectorClock.
   * @param other - The other VectorClock to compare with
   * @returns -1 if this clock is less than the other, 0 if equal, 1 if greater
   */
  compare(other: VectorClock): -1 | 0 | 1 {
    let allLess = true
    let allGreater = true
    const allKeys = new Set([
      ...Object.keys(this.timestamps),
      ...Object.keys(other.timestamps)
    ])
    for (const key of allKeys) {
      const a = this.timestamps[key] || 0
      const b = other.timestamps[key] || 0
      if (a < b) allGreater = false
      if (a > b) allLess = false
    }
    if (allLess && !allGreater) return -1 // Less
    if (allGreater && !allLess) return 1 // Greater
    return 0 // Equal
  }
}

/**
 * Last-Write-Wins Register (LWW-Register) CRDT.
 * This data structure ensures eventual consistency by always choosing the value with the most recent timestamp.
 * In case of equal timestamps, it uses the replica ID as a tie-breaker.
 * @template A - The type of value stored in the register
 */
export class LWWRegister<A> {
  /**
   * Creates a new LWWRegister instance with the specified value, timestamp, and replica ID.
   * @param value - The current value of the register
   * @param timestamp - The timestamp of the value (used for comparison)
   * @param replicaId - The identifier of the replica that created this value
   */
  constructor(
    public readonly value: A,
    public readonly timestamp: number,
    public readonly replicaId: string
  ) {}

  /**
   * Creates a new LWWRegister with the specified initial value and replica ID.
   * @template A - The type of value to store
   * @param value - The initial value
   * @param replicaId - The ID of the replica creating this register
   * @returns A new LWWRegister instance with the current timestamp
   */
  static make<A>(value: A, replicaId: string): LWWRegister<A> {
    return new LWWRegister(value, Date.now(), replicaId)
  }

  /**
   * Sets a new value with a new timestamp.
   * @param value - The new value to set
   * @param replicaId - The ID of the replica setting the value
   * @returns A new LWWRegister instance with the updated value and timestamp
   */
  set(value: A, replicaId: string): LWWRegister<A> {
    return new LWWRegister(value, Date.now(), replicaId)
  }

  /**
   * Merges this register with another register, choosing the value with the later timestamp.
   * In case of equal timestamps, uses the replica ID as a tie-breaker.
   * @param other - The other register to merge with
   * @returns The register with the later timestamp, or the one with the greater replica ID if timestamps are equal
   */
  merge(other: LWWRegister<A>): LWWRegister<A> {
    if (this.timestamp > other.timestamp) {
      return this
    } else if (this.timestamp < other.timestamp) {
      return other
    } else {
      // Same timestamp, use replicaId as deterministic tie-breaker
      return this.replicaId > other.replicaId ? this : other
    }
  }

  /**
   * Gets the current value of the register.
   * @returns The current value
   */
  get(): A {
    return this.value
  }
}

/**
 * Grow-Only Set (G-Set) CRDT.
 * A set that only supports addition of elements, and never removals.
 * The merge function is the union of the sets.
 * @template A - The type of elements stored in the set
 */
export class GSet<A> {
  /**
   * Creates a new GSet instance with optional initial elements.
   * @param elements - Initial elements to include in the set
   */
  constructor(
    public readonly elements: Array<A> = []
  ) {}

  /**
   * Creates an empty GSet with no elements.
   * @template A - The type of elements in the set
   * @returns A new empty GSet instance
   */
  static empty<A>(): GSet<A> {
    return new GSet([])
  }

  /**
   * Adds an element to the set if it's not already present.
   * @param element - The element to add
   * @returns A new GSet instance with the element added
   */
  add(element: A): GSet<A> {
    if (this.elements.includes(element)) {
      return this
    }
    return new GSet([...this.elements, element])
  }

  /**
   * Checks if an element is present in the set.
   * @param element - The element to check for
   * @returns True if the element is in the set, false otherwise
   */
  has(element: A): boolean {
    return this.elements.includes(element)
  }

  /**
   * Gets all values stored in the set.
   * @returns A readonly array of all elements in the set
   */
  values(): ReadonlyArray<A> {
    return this.elements
  }

  /**
   * Merges this set with another set by taking the union of both sets.
   * @param other - The other set to merge with
   * @returns A new GSet containing all elements from both sets
   */
  merge(other: GSet<A>): GSet<A> {
    const merged = new Set([...this.elements, ...other.elements])
    return new GSet(Array.from(merged))
  }

  /**
   * Gets the number of elements in the set.
   * @returns The number of elements in the set
   */
  get size(): number {
    return this.elements.length
  }
}

/**
 * Two-Phase Set (2P-Set) CRDT.
 * A set that allows both additions and removals, but once an element is removed,
 * it cannot be re-added. It maintains two sets: additions and removals.
 * @template A - The type of elements stored in the set
 */
export class TwoPhaseSet<A> {
  /**
   * Creates a new TwoPhaseSet instance with initial additions and removals.
   * @param additions - Initial set of added elements
   * @param removals - Initial set of removed elements
   */
  constructor(
    public readonly additions: Set<A>,
    public readonly removals: Set<A>
  ) {}

  /**
   * Creates an empty TwoPhaseSet with no additions or removals.
   * @template A - The type of elements in the set
   * @returns A new empty TwoPhaseSet instance
   */
  static empty<A>(): TwoPhaseSet<A> {
    return new TwoPhaseSet<A>(new Set(), new Set())
  }

  /**
   * Adds an element to the set if it hasn't been removed before.
   * Elements cannot be re-added after removal in a Two-Phase Set.
   * @param element - The element to add
   * @returns A new TwoPhaseSet instance with the element added (if valid)
   */
  add(element: A): TwoPhaseSet<A> {
    // Element can't be re-added after removal in Two-Phase Set
    if (this.removals.has(element)) {
      return this
    }
    return new TwoPhaseSet<A>(
      new Set([...this.additions, element]),
      this.removals
    )
  }

  /**
   * Removes an element from the set.
   * @param element - The element to remove
   * @returns A new TwoPhaseSet instance with the element marked as removed
   */
  remove(element: A): TwoPhaseSet<A> {
    return new TwoPhaseSet<A>(
      this.additions,
      new Set([...this.removals, element])
    )
  }

  /**
   * Checks if an element is present in the set (added and not removed).
   * @param element - The element to check for
   * @returns True if the element is in the set, false otherwise
   */
  has(element: A): boolean {
    return this.additions.has(element) && !this.removals.has(element)
  }

  /**
   * Gets all values currently present in the set (added and not removed).
   * @returns A readonly array of elements currently in the set
   */
  values(): ReadonlyArray<A> {
    return Array.from(this.additions).filter((item) => !this.removals.has(item))
  }

  /**
   * Merges this set with another set by taking the union of additions and removals.
   * @param other - The other set to merge with
   * @returns A new TwoPhaseSet containing merged additions and removals
   */
  merge(other: TwoPhaseSet<A>): TwoPhaseSet<A> {
    return new TwoPhaseSet<A>(
      new Set([...this.additions, ...other.additions]),
      new Set([...this.removals, ...other.removals])
    )
  }
}

/**
 * Tombstone Set CRDT.
 * A set that preserves ordering and handles element removal by using tombstones.
 * Elements can be removed and their removal persists during merges.
 * @template A - The type of elements stored in the set
 */
export class TombstoneSet<A> {
  /**
   * Creates a new TombstoneSet instance with initial elements and tombstones.
   * @param elements - Map of element IDs to their values, timestamps, and replica IDs
   * @param tombstones - Map of element IDs to their tombstone info (timestamp and replica ID)
   */
  constructor(
    public readonly elements: Map<string, { value: A; timestamp: number; replicaId: string }>,
    public readonly tombstones: Map<string, { timestamp: number; replicaId: string }> // ID -> tombstone info
  ) {}

  /**
   * Creates an empty TombstoneSet with no elements or tombstones.
   * @template A - The type of elements in the set
   * @returns A new empty TombstoneSet instance
   */
  static empty<A>(): TombstoneSet<A> {
    return new TombstoneSet<A>(new Map(), new Map())
  }

  /**
   * Adds an element with a unique ID and timestamp.
   * The element will not be added if there's a more recent tombstone.
   * @param id - Unique identifier for the element
   * @param value - The value to store
   * @param timestamp - The timestamp of the addition
   * @param replicaId - The ID of the replica making the addition
   * @returns A new TombstoneSet instance with the element added (if valid)
   */
  add(id: string, value: A, timestamp: number, replicaId: string): TombstoneSet<A> {
    // Check if there's a more recent tombstone than this addition
    const tombstone = this.tombstones.get(id)
    if (tombstone && tombstone.timestamp >= timestamp) {
      // Tombstone is more recent, don't re-add
      return this
    }
    return new TombstoneSet<A>(
      new Map(this.elements).set(id, { value, timestamp, replicaId }),
      new Map(this.tombstones) // Keep tombstones unchanged
    )
  }

  /**
   * Removes an element by creating a tombstone for it.
   * @param id - The unique identifier of the element to remove
   * @param timestamp - The timestamp of the removal
   * @param replicaId - The ID of the replica making the removal
   * @returns A new TombstoneSet instance with the element tombstoned
   */
  remove(id: string, timestamp: number, replicaId: string): TombstoneSet<A> {
    // Check if there's a more recent element than this removal
    const element = this.elements.get(id)
    if (element && element.timestamp > timestamp) {
      // Element is more recent, don't tombstone
      return this
    }
    const newTombstones = new Map(this.tombstones)
    newTombstones.set(id, { timestamp, replicaId })
    // Remove from elements if it exists
    const newElements = new Map(this.elements)
    newElements.delete(id)
    return new TombstoneSet<A>(newElements, newTombstones)
  }

  /**
   * Checks if an element is present in the set (exists and is not tombstoned).
   * @param id - The unique identifier of the element to check
   * @returns True if the element exists and is not tombstoned or if a more recent element exists than the tombstone
   */
  has(id: string): boolean {
    const element = this.elements.get(id)
    const tombstone = this.tombstones.get(id)
    // If element doesn't exist, it's not present
    if (!element) {
      return false
    }
    // If element exists but there's no tombstone, it's present
    if (!tombstone) {
      return true
    }
    // If both exist, check which is more recent
    return element.timestamp > tombstone.timestamp
  }

  /**
   * Gets the value of an element if it exists and is not tombstoned.
   * @param id - The unique identifier of the element to get
   * @returns The value of the element if it exists and is not tombstoned, otherwise undefined
   */
  get(id: string): A | undefined {
    if (!this.has(id)) {
      return undefined
    }
    const element = this.elements.get(id)
    return element ? element.value : undefined
  }

  /**
   * Gets all values currently present in the set (not tombstoned).
   * Results are sorted by timestamp and replica ID for consistent ordering.
   * @returns An array of objects containing element IDs and their values
   */
  values(): Array<{ id: string; value: A }> {
    const result: Array<{ id: string; value: A }> = []
    for (const [id, element] of this.elements) {
      if (this.has(id)) {
        result.push({ id, value: element.value })
      }
    }
    // Sort by timestamp and replicaId to ensure consistent ordering
    result.sort((a, b) => {
      const elementA = this.elements.get(a.id)!
      const elementB = this.elements.get(b.id)!
      return elementA.timestamp !== elementB.timestamp
        ? elementA.timestamp - elementB.timestamp
        : elementA.replicaId.localeCompare(elementB.replicaId)
    })
    return result
  }

  /**
   * Merges this set with another set, resolving conflicts based on timestamps and replica IDs.
   * @param other - The other set to merge with
   * @returns A new TombstoneSet containing merged elements and tombstones
   */
  merge(other: TombstoneSet<A>): TombstoneSet<A> {
    const mergedElements = new Map(this.elements)
    // Merge elements, keeping the one with the later timestamp
    for (const [id, otherElement] of other.elements) {
      const myElement = mergedElements.get(id)
      if (!myElement) {
        mergedElements.set(id, otherElement)
      } else {
        // If timestamps are the same, use replicaId as tie-breaker
        if (
          otherElement.timestamp > myElement.timestamp ||
          (otherElement.timestamp === myElement.timestamp && otherElement.replicaId > myElement.replicaId)
        ) {
          mergedElements.set(id, otherElement)
        }
      }
    }
    // Merge tombstones, keeping the one with the later timestamp
    const mergedTombstones = new Map(this.tombstones)
    for (const [id, otherTombstone] of other.tombstones) {
      const myTombstone = mergedTombstones.get(id)
      if (!myTombstone) {
        mergedTombstones.set(id, otherTombstone)
      } else {
        // If timestamps are the same, use replicaId as tie-breaker
        if (
          otherTombstone.timestamp > myTombstone.timestamp ||
          (otherTombstone.timestamp === myTombstone.timestamp && otherTombstone.replicaId > myTombstone.replicaId)
        ) {
          mergedTombstones.set(id, otherTombstone)
        }
      }
    }
    // Check all elements against all tombstones to see if any should be removed
    // due to a more recent tombstone
    for (const [id, element] of mergedElements) {
      const tombstone = mergedTombstones.get(id)
      if (tombstone && tombstone.timestamp > element.timestamp) {
        // Tombstone is more recent, remove the element
        mergedElements.delete(id)
      }
    }
    // Check all tombstones against all elements to see if any tombstones
    // are overridden by more recent additions
    for (const [id, tombstone] of mergedTombstones) {
      const element = mergedElements.get(id)
      if (element && element.timestamp > tombstone.timestamp) {
        // Element is more recent, remove the tombstone
        mergedTombstones.delete(id)
      }
    }
    return new TombstoneSet<A>(mergedElements, mergedTombstones)
  }
}

// Define the RGA Element type outside the class to avoid the namespace issue
type RGAElement<A> = {
  readonly id: string
  readonly value: A
  readonly timestamp: number
  readonly replicaId: string
  readonly position: string // Position string like "0.1", "0.2", "0.15" etc.
}

/**
 * Replicated Growable Array (RGA) CRDT.
 * A sequence-based CRDT that allows concurrent insertions, deletions, and movements of elements in an array.
 * @template A - The type of elements stored in the array
 */
export class RGA<A> {
  /**
   * Creates a new RGA instance with initial elements.
   * @param elements - Map of element IDs to their data
   */
  constructor(
    public readonly elements: Map<string, RGAElement<A>>
  ) {}

  /**
   * Creates an empty RGA with no elements.
   * @template A - The type of elements in the array
   * @returns A new empty RGA instance
   */
  static empty<A>(): RGA<A> {
    return new RGA<A>(new Map())
  }

  /**
   * Generates a unique ID for an element based on replica ID and timestamp.
   * @private
   * @param replicaId - The ID of the replica generating the element
   * @param timestamp - The timestamp of the element's creation
   * @returns A unique string ID for the element
   */
  private static generateId(replicaId: string, timestamp: number): string {
    return `${replicaId}:${timestamp}:${Math.random().toString(36).slice(2, 5)}`
  }

  /**
   * Helper to generate a position between two other positions.
   * @private
   * @param prevPos - The position before the desired position (or null if at beginning)
   * @param nextPos - The position after the desired position (or null if at end)
   * @returns A position string that falls between prevPos and nextPos
   */
  private static generatePositionBetween(prevPos: string | null, nextPos: string | null): string {
    if (prevPos === null && nextPos === null) {
      return "0.0"
    } else if (prevPos === null) {
      // Before first element, use a position before nextPos
      return RGA.calculatePositionBefore(nextPos!)
    } else if (nextPos === null) {
      // After last element, use a position after prevPos
      return RGA.calculatePositionAfter(prevPos)
    } else {
      // Between two positions
      return RGA.calculatePositionBetween(prevPos, nextPos)
    }
  }

  /**
   * Calculates a position that comes before the given position.
   * @private
   * @param pos - The position to calculate before
   * @returns A position string that comes before the input position
   */
  private static calculatePositionBefore(pos: string): string {
    // To create a position before the given position, we could try to modify it
    // to be lexicographically smaller than pos.
    // For example, if pos is "0.1", we might return "0.0.999" (theoretically)
    // But a simple approach is to go back in the sequence of positions
    // The most reliable approach is to try to decrement one of the components.
    const parts = pos.split(".").map(Number)
    // Try to decrease a component starting from the end
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i] > 0) {
        parts[i]--
        // Make all following components as large as possible to stay before pos
        for (let j = i + 1; j < parts.length; j++) {
          parts[j] = 0 // Actually, setting to 0 keeps it smaller
        }
        return parts.join(".")
      }
      // If this component is 0, we continue to the next one (borrowing concept)
    }
    // If all components are 0, we can't go lower using this method
    // We'll return a special case - this shouldn't normally happen in RGA usage
    // since positions typically increase
    return "0.0" // Default start position if we can't go lower
  }

  /**
   * Calculates a position that comes after the given position.
   * @private
   * @param pos - The position to calculate after
   * @returns A position string that comes after the input position
   */
  private static calculatePositionAfter(pos: string): string {
    // Increment the last number in the position to get a position that sorts after
    const parts = pos.split(".")
    if (parts.length === 0) {
      return "0.1" // Default next position after initial
    }
    let lastNum = parseInt(parts[parts.length - 1])
    if (isNaN(lastNum)) {
      lastNum = 0 // Fallback if parsing fails
    }
    parts[parts.length - 1] = (lastNum + 1).toString()
    return parts.join(".")
  }

  /**
   * Calculates a position that falls between two given positions.
   * @private
   * @param prevPos - The position before the desired position
   * @param nextPos - The position after the desired position
   * @returns A position string that falls between the two input positions
   */
  private static calculatePositionBetween(prevPos: string, nextPos: string): string {
    const prevParts = prevPos.split(".").map(Number)
    const nextParts = nextPos.split(".").map(Number)
    // Find the common prefix
    let commonLength = 0
    while (
      commonLength < prevParts.length &&
      commonLength < nextParts.length &&
      prevParts[commonLength] === nextParts[commonLength]
    ) {
      commonLength++
    }
    // If prevPos is a prefix of nextPos (e.g., "0.1" and "0.1.1")
    if (commonLength === prevParts.length) {
      // Make sure the next differing part in nextPos is > 0 and return prev + [0]
      if (commonLength < nextParts.length && nextParts[commonLength] > 0) {
        // We can insert prev + [0] which will be > prev and < next
        // For example: between "0.1" and "0.1.1", return "0.1.0"
        return [...prevParts, 0].join(".")
      } else {
        // If nextDiffValue is 0 or no difference exists, we need to go deeper
        // This is a complex case, use an intermediate approach
        return [...prevParts, 0, 1].join(".")
      }
    }
    // If nextPos is a prefix of prevPos (e.g., "0.1.1" and "0.1") - this shouldn't normally occur
    if (commonLength === nextParts.length) {
      // prevPos should be < nextPos in normal usage, so this indicates incorrect input
      return [...prevParts, 0].join(".")
    }
    // The components differ at position commonLength
    const prevValue = prevParts[commonLength]
    const nextValue = nextParts[commonLength]
    // If there's a gap between the values, use the midpoint
    if (nextValue > prevValue + 1) {
      const midValue = Math.floor((prevValue + nextValue) / 2)
      return [...prevParts.slice(0, commonLength), midValue].join(".")
    } else {
      // Values are consecutive (nextValue = prevValue + 1), need to continue with prev's sequence
      // and add a component to make it larger than prev but smaller than next
      // For example: between "0.1.9" and "0.2.0", we can't use "0.1.5" since "0.1.5" < "0.1.9"
      // Instead, we use the entire prev sequence and add a small value to make it slightly larger
      if (commonLength + 1 < prevParts.length) {
        // If prev has more components after the divergent position, we need to handle carefully
        return [...prevParts, 0].join(".") // Add a 0 to make it larger than prev but potentially smaller than next
      } else {
        // prev has no more components after the divergent position, so we extend with a small number
        return [...prevParts, 5].join(".") // Add 5 to make it larger than prev
      }
    }
  }

  /**
   * Appends an element to the end of the array.
   * @param value - The value to append
   * @param replicaId - The ID of the replica appending the element
   * @returns A new RGA instance with the element appended
   */
  append(value: A, replicaId: string): RGA<A> {
    const timestamp = Date.now()
    const id = RGA.generateId(replicaId, timestamp)
    const allElements = Array.from(this.elements.values())
    // Sort by position to determine the last element
    allElements.sort((a, b) => a.position.localeCompare(b.position))
    const lastPos = allElements.length > 0 ? allElements[allElements.length - 1].position : null
    const position = RGA.generatePositionBetween(lastPos, null)
    const newElement: RGAElement<A> = {
      id,
      value,
      timestamp,
      replicaId,
      position
    }
    return new RGA<A>(
      new Map(this.elements).set(id, newElement)
    )
  }

  /**
   * Inserts an element at a specific index in the array.
   * @param index - The index at which to insert the element
   * @param value - The value to insert
   * @param replicaId - The ID of the replica inserting the element
   * @returns A new RGA instance with the element inserted
   */
  insertAt(index: number, value: A, replicaId: string): RGA<A> {
    const allElements = Array.from(this.elements.values())
    // Sort by position to get logical order
    allElements.sort((a, b) => a.position.localeCompare(b.position))
    let prevPos: string | null = null
    let nextPos: string | null = null
    if (index <= 0) {
      // Insert at beginning
      if (allElements.length > 0) {
        nextPos = allElements[0].position
      }
    } else if (index >= allElements.length) {
      // Insert at end
      if (allElements.length > 0) {
        prevPos = allElements[allElements.length - 1].position
      }
    } else {
      // Insert between elements
      prevPos = allElements[index - 1].position
      nextPos = allElements[index].position
    }
    const timestamp = Date.now()
    const id = RGA.generateId(replicaId, timestamp)
    const position = RGA.generatePositionBetween(prevPos, nextPos)
    const newElement: RGAElement<A> = {
      id,
      value,
      timestamp,
      replicaId,
      position
    }
    return new RGA<A>(
      new Map(this.elements).set(id, newElement)
    )
  }

  /**
   * Removes an element at a specific index from the array.
   * @param index - The index of the element to remove
   * @returns A new RGA instance with the element removed, or the same instance if index is out of bounds
   */
  removeAt(index: number): RGA<A> {
    const allElements = Array.from(this.elements.values())
    // Sort by position to get logical order
    allElements.sort((a, b) => a.position.localeCompare(b.position))
    if (index < 0 || index >= allElements.length) {
      return this // Index out of bounds
    }
    const elementToRemove = allElements[index]
    const newElements = new Map(this.elements)
    newElements.delete(elementToRemove.id)
    return new RGA<A>(newElements)
  }

  /**
   * Gets the element at a specific logical position (index) in the array.
   * @param index - The logical index of the element to get
   * @returns The value of the element at the specified index, or undefined if index is out of bounds
   */
  get(index: number): A | undefined {
    const allElements = Array.from(this.elements.values())
    // Sort by position to get logical order
    allElements.sort((a, b) => a.position.localeCompare(b.position))
    if (index < 0 || index >= allElements.length) {
      return undefined
    }
    return allElements[index].value
  }

  /**
   * Gets the length of the array (number of elements).
   * @returns The number of elements in the array
   */
  get length(): number {
    return this.elements.size
  }

  /**
   * Converts the RGA to a regular array in logical order.
   * @returns An array containing all elements in the RGA, sorted by logical position
   */
  toArray(): Array<A> {
    const allElements = Array.from(this.elements.values())
    // Sort by position to get logical order
    allElements.sort((a, b) => a.position.localeCompare(b.position))
    return allElements.map((element) => element.value)
  }

  /**
   * Merges this RGA with another RGA by combining their elements.
   * In case of ID conflicts, the element with the later timestamp is used.
   * @param other - The other RGA to merge with
   * @returns A new RGA instance containing merged elements
   */
  merge(other: RGA<A>): RGA<A> {
    // Simply merge the maps - if same ID exists in both, use the one with later timestamp
    const mergedElements = new Map(this.elements)
    for (const [id, otherElement] of other.elements) {
      const thisElement = mergedElements.get(id)
      if (!thisElement) {
        // New element from other RGA
        mergedElements.set(id, otherElement)
      } else {
        // Conflict: same ID in both RGAs - use element with later timestamp
        if (
          otherElement.timestamp > thisElement.timestamp ||
          (otherElement.timestamp === thisElement.timestamp &&
            otherElement.replicaId > thisElement.replicaId)
        ) {
          mergedElements.set(id, otherElement)
        }
      }
    }
    return new RGA<A>(mergedElements)
  }
}

/**
 * Positive-Negative Counter (PN-Counter) CRDT.
 * A counter that supports both incrementing and decrementing operations.
 * It tracks increment and decrement operations separately and merges them by taking the max value for each replica.
 */
export class PNCounter {
  /**
   * Creates a new PNCounter instance with initial increment and decrement values.
   * @param increments - Map of replica IDs to their increment counts
   * @param decrements - Map of replica IDs to their decrement counts
   */
  constructor(
    public readonly increments: Map<string, number>, // replicaId -> increment count
    public readonly decrements: Map<string, number> // replicaId -> decrement count
  ) {}

  /**
   * Creates an empty PNCounter with no increments or decrements.
   * @returns A new empty PNCounter instance
   */
  static empty(): PNCounter {
    return new PNCounter(new Map(), new Map())
  }

  /**
   * Increments the counter by a specified amount for the given replica.
   * @param replicaId - The ID of the replica performing the increment
   * @param by - The amount to increment by (default is 1)
   * @returns A new PNCounter instance with the incremented value
   */
  increment(replicaId: string, by: number = 1): PNCounter {
    const current = this.increments.get(replicaId) || 0
    const newIncrements = new Map(this.increments).set(replicaId, current + by)
    return new PNCounter(newIncrements, this.decrements)
  }

  /**
   * Decrements the counter by a specified amount for the given replica.
   * @param replicaId - The ID of the replica performing the decrement
   * @param by - The amount to decrement by (default is 1)
   * @returns A new PNCounter instance with the decremented value
   */
  decrement(replicaId: string, by: number = 1): PNCounter {
    const current = this.decrements.get(replicaId) || 0
    const newDecrements = new Map(this.decrements).set(replicaId, current + by)
    return new PNCounter(this.increments, newDecrements)
  }

  /**
   * Gets the current value of the counter (total increments minus total decrements).
   * @returns The current counter value
   */
  value(): number {
    let totalIncrements = 0
    for (const count of this.increments.values()) {
      totalIncrements += count
    }
    let totalDecrements = 0
    for (const count of this.decrements.values()) {
      totalDecrements += count
    }
    return totalIncrements - totalDecrements
  }

  /**
   * Merges this counter with another counter by taking the max value for each replica's increments and decrements.
   * @param other - The other counter to merge with
   * @returns A new PNCounter containing merged increment and decrement values
   */
  merge(other: PNCounter): PNCounter {
    const mergedIncrements = new Map(this.increments)
    for (const [replicaId, count] of other.increments.entries()) {
      const current = mergedIncrements.get(replicaId) || 0
      mergedIncrements.set(replicaId, Math.max(current, count))
    }
    const mergedDecrements = new Map(this.decrements)
    for (const [replicaId, count] of other.decrements.entries()) {
      const current = mergedDecrements.get(replicaId) || 0
      mergedDecrements.set(replicaId, Math.max(current, count))
    }
    return new PNCounter(mergedIncrements, mergedDecrements)
  }
}

/**
 * Entry for the OR-Map (Observed-Remove Map) CRDT.
 * Represents a key-value pair that can be added and removed independently by different replicas.
 * @template A - The type of value stored in the entry
 */
export class ORMapEntry<A> {
  /**
   * Creates a new ORMapEntry instance with a value, addition timestamp, and optional removal timestamp.
   * @param value - The value stored in the entry
   * @param added - Timestamp of when the entry was added
   * @param removed - Optional timestamp of when the entry was removed (None if not removed)
   */
  constructor(
    public readonly value: A,
    public readonly added: number,
    public readonly removed: Option.Option<number>
  ) {}

  /**
   * Checks if the entry is currently visible (not removed).
   * @returns True if the entry has not been removed, false otherwise
   */
  isVisible(): boolean {
    return Option.isNone(this.removed)
  }
}

/**
 * Ordered Set CRDT with tombstones.
 * A set that maintains ordering and allows element removal by using tombstones.
 * Elements are identified by unique IDs and can be added/removed independently.
 * @template A - The type of elements stored in the set
 */
export class OrderedSet<A> {
  /**
   * Creates a new OrderedSet instance with initial elements and tombstones.
   * @param elements - Map of element IDs to their values, timestamps, and replica IDs
   * @param tombstones - Set of IDs representing removed elements
   */
  constructor(
    public readonly elements: Map<string, { value: A; timestamp: number; replicaId: string }>,
    public readonly tombstones: Set<string> // IDs of removed elements
  ) {}

  /**
   * Creates an empty OrderedSet with no elements or tombstones.
   * @template A - The type of elements in the set
   * @returns A new empty OrderedSet instance
   */
  static empty<A>(): OrderedSet<A> {
    return new OrderedSet<A>(new Map(), new Set())
  }

  /**
   * Adds an element with a unique ID and timestamp.
   * The element will not be added if it has been tombstoned.
   * @param id - Unique identifier for the element
   * @param value - The value to store
   * @param timestamp - The timestamp of the addition
   * @param replicaId - The ID of the replica making the addition
   * @returns A new OrderedSet instance with the element added (if valid)
   */
  add(id: string, value: A, timestamp: number, replicaId: string): OrderedSet<A> {
    if (this.tombstones.has(id)) {
      // Element was tombstoned, don't re-add
      return this
    }
    return new OrderedSet<A>(
      new Map(this.elements).set(id, { value, timestamp, replicaId }),
      this.tombstones
    )
  }

  /**
   * Removes an element by adding its ID to the tombstones set.
   * @param id - The unique identifier of the element to remove
   * @returns A new OrderedSet instance with the element tombstoned
   */
  remove(id: string): OrderedSet<A> {
    const newTombstones = new Set(this.tombstones)
    newTombstones.add(id)
    return new OrderedSet<A>(
      this.elements,
      newTombstones
    )
  }

  /**
   * Checks if an element is present in the set (exists and not tombstoned).
   * @param id - The unique identifier of the element to check
   * @returns True if the element exists and is not tombstoned, false otherwise
   */
  has(id: string): boolean {
    return this.elements.has(id) && !this.tombstones.has(id)
  }

  /**
   * Gets the value of an element if it exists and is not tombstoned.
   * @param id - The unique identifier of the element to get
   * @returns The value of the element if it exists and is not tombstoned, otherwise undefined
   */
  get(id: string): A | undefined {
    const element = this.elements.get(id)
    if (!element || this.tombstones.has(id)) {
      return undefined
    }
    return element.value
  }

  /**
   * Gets all values currently present in the set (not tombstoned).
   * Results are sorted by timestamp and replica ID for consistent ordering.
   * @returns An array of objects containing element IDs and their values
   */
  values(): Array<{ id: string; value: A }> {
    const result: Array<{ id: string; value: A }> = []
    for (const [id, element] of this.elements) {
      if (!this.tombstones.has(id)) {
        result.push({ id, value: element.value })
      }
    }
    // Sort by timestamp and replicaId to ensure consistent ordering
    result.sort((a, b) => {
      const elementA = this.elements.get(a.id)!
      const elementB = this.elements.get(b.id)!
      if (elementA.timestamp !== elementB.timestamp) {
        return elementA.timestamp - elementB.timestamp
      }
      return elementA.replicaId.localeCompare(elementB.replicaId)
    })
    return result
  }

  /**
   * Merges this set with another set, resolving conflicts based on timestamps and replica IDs.
   * @param other - The other set to merge with
   * @returns A new OrderedSet containing merged elements and combined tombstones
   */
  merge(other: OrderedSet<A>): OrderedSet<A> {
    const mergedElements = new Map(this.elements)
    // Merge elements, keeping the one with the later timestamp
    for (const [id, otherElement] of other.elements) {
      const myElement = mergedElements.get(id)
      if (!myElement) {
        mergedElements.set(id, otherElement)
      } else {
        // If timestamps are the same, use replicaId as tie-breaker
        if (
          otherElement.timestamp > myElement.timestamp ||
          (otherElement.timestamp === myElement.timestamp && otherElement.replicaId > myElement.replicaId)
        ) {
          mergedElements.set(id, otherElement)
        }
      }
    }
    // Union of tombstones
    const mergedTombstones = new Set([...this.tombstones, ...other.tombstones])
    return new OrderedSet<A>(mergedElements, mergedTombstones)
  }
}

/**
 * Observed-Remove Map (OR-Map) CRDT.
 * A map that allows concurrent additions and removals of key-value pairs across multiple replicas.
 * The "observed" semantics mean that a key can only be removed after it has been observed by all replicas.
 * @template A - The type of values stored in the map
 */
export class ORMap<A> {
  /**
   * Creates a new ORMap instance with initial entries.
   * @param entries - Initial key-value entries for the map
   */
  constructor(
    public readonly entries: Record<string, ORMapEntry<A>> = {}
  ) {}

  /**
   * Creates an empty ORMap with no entries.
   * @template A - The type of values in the map
   * @returns A new empty ORMap instance
   */
  static empty<A>(): ORMap<A> {
    return new ORMap({})
  }

  /**
   * Adds or updates a key-value pair in the map.
   * @param key - The key to add or update
   * @param value - The value to associate with the key
   * @returns A new ORMap instance with the updated key-value pair
   */
  put(key: string, value: A): ORMap<A> {
    return new ORMap({
      ...this.entries,
      [key]: new ORMapEntry(value, Date.now(), Option.none())
    })
  }

  /**
   * Removes a key-value pair from the map by marking it as removed.
   * @param key - The key to remove
   * @returns A new ORMap instance with the key marked as removed, or the same instance if key doesn't exist
   */
  remove(key: string): ORMap<A> {
    const existing = this.entries[key]
    if (!existing || !existing.isVisible()) {
      return this
    }
    return new ORMap({
      ...this.entries,
      [key]: new ORMapEntry(existing.value, existing.added, Option.some(Date.now()))
    })
  }

  /**
   * Gets the value associated with a key if it exists and hasn't been removed.
   * @param key - The key to get the value for
   * @returns An Option containing the value if the key exists and isn't removed, or None
   */
  get(key: string): Option.Option<A> {
    const entry = this.entries[key]
    return entry && entry.isVisible()
      ? Option.some(entry.value)
      : Option.none()
  }

  /**
   * Converts the ORMap to a plain record object containing only visible entries.
   * @returns A readonly record containing only the visible key-value pairs
   */
  toRecord(): Readonly<Record<string, A>> {
    const result: Record<string, A> = {}
    for (const [key, entry] of Object.entries(this.entries)) {
      if (entry.isVisible()) {
        result[key] = entry.value
      }
    }
    return result
  }

  /**
   * Merges this map with another map, resolving conflicts by taking the entry with the latest activity.
   * @param other - The other map to merge with
   * @returns A new ORMap containing merged entries
   */
  merge(other: ORMap<A>): ORMap<A> {
    const merged = { ...this.entries }
    for (const [key, otherEntry] of Object.entries(other.entries)) {
      const myEntry = merged[key]
      if (!myEntry) {
        merged[key] = otherEntry
      } else {
        // Keep the entry with the latest activity
        const myLatest = Option.getOrElse(myEntry.removed, () => myEntry.added)
        const otherLatest = Option.getOrElse(otherEntry.removed, () => otherEntry.added)
        if (otherLatest > myLatest) {
          merged[key] = otherEntry
        }
      }
    }
    return new ORMap(merged)
  }
}
