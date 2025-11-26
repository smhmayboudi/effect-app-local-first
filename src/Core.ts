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
