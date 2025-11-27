import { Context, Effect, Layer, type Option, Ref, Schedule, Stream } from "effect"
import { GSet, LWWRegister, ORMap, VectorClock } from "./Core.js"
import { CRDTError, type LocalFirstError, StorageError } from "./Errors.js"
import { type Hub, HubService, HubServiceLive, type HubStrategy } from "./Hub.js"
import { IndexedDBLive, MemoryStorageLive, type StorageBackend, StorageService } from "./Storage.js"
import { ManualSyncLive, type SyncOperation, SyncService, WebSocketSyncLive } from "./Sync.js"

export interface LocalFirstConfig {
  readonly storage: "indexeddb" | "memory"
  readonly sync: "websocket" | "manual"
  readonly syncUrl?: string
  readonly replicaId: string
  readonly autoSyncInterval?: number
}

export class LocalFirst extends Context.Tag("@core/LocalFirst")<
  LocalFirst,
  {
    readonly config: LocalFirstConfig
    readonly storage: StorageService
    readonly sync: SyncService
    readonly hubService: HubService
    readonly vectorClock: Ref.Ref<VectorClock>
  }
>() {}

export const LocalFirstLive = (config: LocalFirstConfig) =>
  Layer.effect(
    LocalFirst,
    Effect.gen(function*() {
      const storage = yield* StorageService
      const sync = yield* SyncService
      const hubService = yield* HubService
      const vectorClock = yield* Ref.make(VectorClock.empty())
      // Auto-sync background process
      if (config.autoSyncInterval && config.sync !== "manual") {
        yield* Effect.fork(
          Effect.repeat(
            Effect.gen(function*() {
              const operations = yield* sync.pull()
              yield* applyOperations(operations, storage, vectorClock, config.replicaId)
            }),
            Schedule.spaced(config.autoSyncInterval)
          )
        )
      }
      return {
        config,
        storage: storage as StorageService,
        sync: sync as SyncService,
        hubService: hubService as HubService,
        vectorClock
      }
    })
  ).pipe(
    Layer.provide(
      config.storage === "indexeddb" ? IndexedDBLive : MemoryStorageLive
    ),
    Layer.provide(
      config.sync === "websocket" && config.syncUrl
        ? WebSocketSyncLive(config.syncUrl)
        : ManualSyncLive
    ),
    Layer.provide(HubServiceLive)
  )

// Collection API
export class Collection<A> {
  constructor(
    private readonly name: string
  ) {}

  /**
   * Create a new Hub through the LocalFirst framework
   */
  createHub<T>(
    strategy?: HubStrategy
  ): Effect.Effect<Hub<T>, LocalFirstError, HubService> {
    return Effect.gen(function*() {
      const hubService = yield* HubService
      return yield* hubService.createHub<T>(strategy)
    })
  }

  get(): Effect.Effect<A, LocalFirstError, StorageService> {
    const self = this
    return Effect.gen(function*() {
      const storage = yield* StorageService
      return yield* storage.get(self.name).pipe(
        Effect.map((data) => data as A),
        Effect.catchTag("StorageError", () =>
          Effect.fail(
            new CRDTError({
              message: `Collection ${self.name} not found`,
              operation: "get"
            })
          ))
      )
    })
  }

  set(value: A): Effect.Effect<void, LocalFirstError, StorageService | SyncService | LocalFirst> {
    const self = this
    return Effect.gen(function*() {
      const storage = yield* StorageService
      const sync = yield* SyncService
      const localFirst = yield* LocalFirst
      const vectorClock = localFirst.vectorClock
      // Update local storage
      yield* storage.set(self.name, value)
      // Create sync operation
      const clock = yield* Ref.get(vectorClock)
      const newClock = clock.increment(localFirst.config.replicaId)
      yield* Ref.set(vectorClock, newClock)
      const operation = {
        id: Math.random().toString(36).slice(2, 11),
        type: "set" as const,
        key: self.name,
        value,
        timestamp: Date.now(),
        replicaId: localFirst.config.replicaId,
        vectorClock: newClock
      }
      // Push to sync engine
      yield* sync.push([operation]).pipe(
        Effect.catchAll(() => Effect.void) // Fail silently for offline
      )
    })
  }

  watch(): Stream.Stream<A, LocalFirstError, StorageService> {
    const self = this
    return Stream.unwrapScoped(
      Effect.map(
        StorageService,
        (storage) => storage.watch(self.name)
      ) as Effect.Effect<Stream.Stream<unknown, StorageError, never>, StorageError, StorageService>
    ).pipe(
      Stream.map((data) => data as A),
      Stream.mapError((error) =>
        new CRDTError({
          message: `Failed to watch collection ${self.name}`,
          operation: "watch",
          cause: error
        })
      )
    )
  }
}

// CRDT Collections
export class LWWRegisterCollection<A> extends Collection<LWWRegister<A>> {
  constructor(name: string) {
    super(name)
  }

  setValue(value: A): Effect.Effect<void, LocalFirstError, StorageService | SyncService | LocalFirst> {
    const self = this
    return Effect.gen(function*() {
      const current = yield* self.get().pipe(
        Effect.catchAll(() =>
          Effect.gen(function*() {
            const localFirst = yield* LocalFirst
            return LWWRegister.make(value, localFirst.config.replicaId)
          })
        )
      )
      const localFirst = yield* LocalFirst
      const updated = current.set(value, localFirst.config.replicaId)
      yield* self.set(updated)
    })
  }

  getValue(): Effect.Effect<A, LocalFirstError, StorageService> {
    return this.get().pipe(Effect.map((register) => register.get()))
  }
}

export class GSetCollection<A> extends Collection<GSet<A>> {
  constructor(name: string) {
    super(name)
  }

  add(element: A): Effect.Effect<void, LocalFirstError, StorageService | SyncService | LocalFirst> {
    const self = this
    return Effect.gen(function*() {
      const current = yield* self.get().pipe(
        Effect.catchAll(() => Effect.succeed(GSet.empty<A>()))
      )
      const updated = current.add(element)
      yield* self.set(updated)
    })
  }

  values(): Effect.Effect<ReadonlyArray<A>, LocalFirstError, StorageService> {
    return this.get().pipe(Effect.map((set) => set.values()))
  }

  has(element: A): Effect.Effect<boolean, LocalFirstError, StorageService> {
    return this.get().pipe(Effect.map((set) => set.has(element)))
  }
}

export class ORMapCollection<A> extends Collection<ORMap<A>> {
  constructor(name: string) {
    super(name)
  }

  put(key: string, value: A): Effect.Effect<void, LocalFirstError, StorageService | SyncService | LocalFirst> {
    const self = this
    return Effect.gen(function*() {
      const current = yield* self.get().pipe(
        Effect.catchAll(() => Effect.succeed(ORMap.empty<A>()))
      )
      const updated = current.put(key, value)
      yield* self.set(updated)
    })
  }

  remove(key: string): Effect.Effect<void, LocalFirstError, StorageService | SyncService | LocalFirst> {
    const self = this
    return Effect.gen(function*() {
      const current = yield* self.get()
      const updated = current.remove(key)
      yield* self.set(updated)
    })
  }

  getForKey(key: string): Effect.Effect<Option.Option<A>, LocalFirstError, StorageService> {
    const self = this
    return Effect.gen(function*() {
      const map = yield* self.get()
      return map.get(key)
    })
  }

  entries(): Effect.Effect<Readonly<Record<string, A>>, LocalFirstError, StorageService> {
    return this.get().pipe(Effect.map((map) => map.toRecord()))
  }
}

// Helper function to apply sync operations
const applyOperations = (
  operations: Array<SyncOperation>,
  storage: StorageService,
  vectorClock: Ref.Ref<VectorClock>,
  replicaId: string
): Effect.Effect<void, StorageError, never> =>
  Effect.gen(function*() {
    const backend = storage as StorageBackend
    for (const operation of operations) {
      if (operation.replicaId === replicaId) {
        continue // Skip our own operations
      }
      const currentClock = yield* Ref.get(vectorClock)
      if (operation.vectorClock.compare(currentClock) === -1) { // Less
        continue // Skip outdated operations
      }
      if (operation.type === "set") {
        yield* backend.set(operation.key, operation.value!).pipe(
          Effect.catchAll((error) =>
            Effect.fail(new StorageError({ message: "Failed to set operation", cause: error }))
          )
        )
      } else if (operation.type === "delete") {
        yield* backend.delete(operation.key).pipe(
          Effect.catchAll((error) =>
            Effect.fail(new StorageError({ message: "Failed to delete operation", cause: error }))
          )
        )
      }
      yield* Ref.set(vectorClock, operation.vectorClock)
    }
  })
