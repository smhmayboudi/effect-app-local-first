import { Option } from "effect"

export class VectorClock {
  constructor(
    public readonly timestamps: Record<string, number> = {}
  ) {}

  static empty(): VectorClock {
    return new VectorClock({})
  }

  increment(replicaId: string): VectorClock {
    const current = this.timestamps[replicaId] || 0
    return new VectorClock({
      ...this.timestamps,
      [replicaId]: current + 1
    })
  }

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

export class LWWRegister<A> {
  constructor(
    public readonly value: A,
    public readonly timestamp: number,
    public readonly replicaId: string
  ) {}

  static make<A>(value: A, replicaId: string): LWWRegister<A> {
    return new LWWRegister(value, Date.now(), replicaId)
  }

  set(value: A, replicaId: string): LWWRegister<A> {
    return new LWWRegister(value, Date.now(), replicaId)
  }

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

  get(): A {
    return this.value
  }
}

export class GSet<A> {
  constructor(
    public readonly elements: Array<A> = []
  ) {}

  static empty<A>(): GSet<A> {
    return new GSet([])
  }

  add(element: A): GSet<A> {
    if (this.elements.includes(element)) {
      return this
    }
    return new GSet([...this.elements, element])
  }

  has(element: A): boolean {
    return this.elements.includes(element)
  }

  values(): ReadonlyArray<A> {
    return this.elements
  }

  merge(other: GSet<A>): GSet<A> {
    const merged = new Set([...this.elements, ...other.elements])
    return new GSet(Array.from(merged))
  }

  get size(): number {
    return this.elements.length
  }
}

export class TwoPhaseSet<A> {
  constructor(
    public readonly additions: Set<A>,
    public readonly removals: Set<A>
  ) {}

  static empty<A>(): TwoPhaseSet<A> {
    return new TwoPhaseSet<A>(new Set(), new Set())
  }

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

  remove(element: A): TwoPhaseSet<A> {
    return new TwoPhaseSet<A>(
      this.additions,
      new Set([...this.removals, element])
    )
  }

  has(element: A): boolean {
    return this.additions.has(element) && !this.removals.has(element)
  }

  values(): ReadonlyArray<A> {
    return Array.from(this.additions).filter((item) => !this.removals.has(item))
  }

  merge(other: TwoPhaseSet<A>): TwoPhaseSet<A> {
    return new TwoPhaseSet<A>(
      new Set([...this.additions, ...other.additions]),
      new Set([...this.removals, ...other.removals])
    )
  }
}

// A fully commutative ordered set with tombstones
// A proper tombstone-based set with timestamps
export class TombstoneSet<A> {
  constructor(
    public readonly elements: Map<string, { value: A; timestamp: number; replicaId: string }>,
    public readonly tombstones: Map<string, { timestamp: number; replicaId: string }> // ID -> tombstone info
  ) {}

  static empty<A>(): TombstoneSet<A> {
    return new TombstoneSet<A>(new Map(), new Map())
  }

  // Add an element with a unique ID (usually a UUID with replica info)
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

  get(id: string): A | undefined {
    if (!this.has(id)) {
      return undefined
    }
    const element = this.elements.get(id)
    return element ? element.value : undefined
  }

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

      if (elementA.timestamp !== elementB.timestamp) {
        return elementA.timestamp - elementB.timestamp
      }
      return elementA.replicaId.localeCompare(elementB.replicaId)
    })
    return result
  }

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

// A simple position-based array CRDT
export class RGA<A> {
  constructor(
    public readonly elements: Map<string, RGAElement<A>>
  ) {}

  static empty<A>(): RGA<A> {
    return new RGA<A>(new Map())
  }

  // Generate a unique ID for an element
  private static generateId(replicaId: string, timestamp: number): string {
    return `${replicaId}:${timestamp}:${Math.random().toString(36).substr(2, 5)}`
  }

  // Helper to generate a position between two other positions
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

  private static calculatePositionBefore(pos: string): string {
    // Simplified: just add ".1" to the position
    return `${pos}.1`
  }

  private static calculatePositionAfter(pos: string): string {
    // Simplified: increment the last number in the position
    const parts = pos.split(".")
    const lastNum = parseInt(parts[parts.length - 1])
    parts[parts.length - 1] = (lastNum + 1).toString()
    return parts.join(".")
  }

  private static calculatePositionBetween(prevPos: string, nextPos: string): string {
    // Simplified: create an intermediate position
    return `${prevPos}.5`
  }

  // Append an element to the end
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

  // Insert at a specific index
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

  // Remove element at a specific index
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

  // Get element at a specific logical position (index)
  get(index: number): A | undefined {
    const allElements = Array.from(this.elements.values())

    // Sort by position to get logical order
    allElements.sort((a, b) => a.position.localeCompare(b.position))

    if (index < 0 || index >= allElements.length) {
      return undefined
    }

    return allElements[index].value
  }

  // Get the length of the array
  get length(): number {
    return this.elements.size
  }

  // Convert to a regular array in logical order
  toArray(): Array<A> {
    const allElements = Array.from(this.elements.values())

    // Sort by position to get logical order
    allElements.sort((a, b) => a.position.localeCompare(b.position))

    return allElements.map((element) => element.value)
  }

  // Merge two RGAs
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

// Positive-Negative Counter (PN-Counter)
export class PNCounter {
  constructor(
    public readonly increments: Map<string, number>, // replicaId -> increment count
    public readonly decrements: Map<string, number> // replicaId -> decrement count
  ) {}

  static empty(): PNCounter {
    return new PNCounter(new Map(), new Map())
  }

  increment(replicaId: string, by: number = 1): PNCounter {
    const current = this.increments.get(replicaId) || 0
    const newIncrements = new Map(this.increments).set(replicaId, current + by)
    return new PNCounter(newIncrements, this.decrements)
  }

  decrement(replicaId: string, by: number = 1): PNCounter {
    const current = this.decrements.get(replicaId) || 0
    const newDecrements = new Map(this.decrements).set(replicaId, current + by)
    return new PNCounter(this.increments, newDecrements)
  }

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

export class ORMapEntry<A> {
  constructor(
    public readonly value: A,
    public readonly added: number,
    public readonly removed: Option.Option<number>
  ) {}

  isVisible(): boolean {
    return Option.isNone(this.removed)
  }
}

export class OrderedSet<A> {
  constructor(
    public readonly elements: Map<string, { value: A; timestamp: number; replicaId: string }>,
    public readonly tombstones: Set<string> // IDs of removed elements
  ) {}

  static empty<A>(): OrderedSet<A> {
    return new OrderedSet<A>(new Map(), new Set())
  }

  // Add an element with a unique ID (usually a UUID with replica info)
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

  remove(id: string): OrderedSet<A> {
    const newTombstones = new Set(this.tombstones)
    newTombstones.add(id)

    return new OrderedSet<A>(
      this.elements,
      newTombstones
    )
  }

  has(id: string): boolean {
    return this.elements.has(id) && !this.tombstones.has(id)
  }

  get(id: string): A | undefined {
    const element = this.elements.get(id)
    if (!element || this.tombstones.has(id)) {
      return undefined
    }
    return element.value
  }

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

export class ORMap<A> {
  constructor(
    public readonly entries: Record<string, ORMapEntry<A>> = {}
  ) {}

  static empty<A>(): ORMap<A> {
    return new ORMap({})
  }

  put(key: string, value: A): ORMap<A> {
    return new ORMap({
      ...this.entries,
      [key]: new ORMapEntry(value, Date.now(), Option.none())
    })
  }

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

  get(key: string): Option.Option<A> {
    const entry = this.entries[key]
    return entry && entry.isVisible()
      ? Option.some(entry.value)
      : Option.none()
  }

  toRecord(): Readonly<Record<string, A>> {
    const result: Record<string, A> = {}
    for (const [key, entry] of Object.entries(this.entries)) {
      if (entry.isVisible()) {
        result[key] = entry.value
      }
    }
    return result
  }

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
