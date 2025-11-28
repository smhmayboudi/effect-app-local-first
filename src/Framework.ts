import { Context, Effect, Layer, type Option, Ref, Schedule, Stream } from "effect"
import { GSet, LWWRegister, OrderedSet, ORMap, PNCounter, RGA, TwoPhaseSet, VectorClock } from "./Core.js"
import { CRDTError, type LocalFirstError, StorageError } from "./Errors.js"
import { type Hub, HubService, HubServiceLive, type HubStrategy } from "./Hub.js"
import { IndexedDBLive, MemoryStorageLive, type StorageBackend, StorageService } from "./Storage.js"
import {
  ManualSyncLive,
  type ReconciliationRequest,
  type ReconciliationResponse,
  type SyncOperation,
  SyncService,
  WebSocketSyncLive
} from "./Sync.js"

// Authorization and Access Control Types
export type Permission =
  | "read"
  | "write"
  | "delete"
  | "admin"

export interface Subject {
  readonly id: string
  readonly type: "user" | "service" | "system"
  readonly roles: Array<string>
  readonly permissions: Array<Permission>
}

export interface Resource {
  readonly id: string
  readonly type: string
  readonly owner?: string
  readonly acl?: {
    readonly read?: Array<string> // User IDs or role IDs
    readonly write?: Array<string> // User IDs or role IDs
    readonly delete?: Array<string> // User IDs or role IDs
  }
}

export interface AuthorizationPolicy {
  readonly id: string
  readonly resourceType: string
  readonly conditions: Array<(subject: Subject, resource: Resource, action: Permission) => boolean>
  readonly effect: "allow" | "deny"
  readonly priority: number
}

export interface AuthorizationService {
  readonly checkPermission: (
    subject: Subject,
    resource: Resource,
    action: Permission
  ) => Effect.Effect<boolean, never, never>
  readonly addPolicy: (policy: AuthorizationPolicy) => Effect.Effect<void, never, never>
  readonly removePolicy: (policyId: string) => Effect.Effect<void, never, never>
}

export const AuthorizationService = Context.GenericTag<AuthorizationService>("AuthorizationService")

// Business logic hooks for read/write operations
export interface BusinessLogicHook {
  readonly beforeRead?: (key: string, currentValue: unknown) => Effect.Effect<unknown, LocalFirstError, never>
  readonly afterRead?: (key: string, value: unknown) => Effect.Effect<unknown, LocalFirstError, never>
  readonly beforeWrite?: (
    key: string,
    newValue: unknown,
    currentValue?: unknown
  ) => Effect.Effect<unknown, LocalFirstError, never>
  readonly afterWrite?: (key: string, newValue: unknown) => Effect.Effect<void, LocalFirstError, never>
  readonly validation?: (key: string, value: unknown) => Effect.Effect<boolean, LocalFirstError, never>
}

export interface LocalFirstConfig {
  readonly storage: "indexeddb" | "memory"
  readonly sync: "websocket" | "manual"
  readonly syncUrl?: string
  readonly replicaId: string
  readonly autoSyncInterval?: number
  readonly authorization?: {
    readonly enabled: boolean
    readonly defaultSubject?: Subject
  }
  readonly businessLogic?: {
    readonly globalHook?: BusinessLogicHook
    readonly collectionHooks?: Record<string, BusinessLogicHook>
  }
}

export class LocalFirst extends Context.Tag("@core/LocalFirst")<
  LocalFirst,
  {
    readonly config: LocalFirstConfig
    readonly storage: StorageService
    readonly sync: SyncService
    readonly hubService: HubService
    readonly vectorClock: Ref.Ref<VectorClock>
    readonly authorizationService?: AuthorizationService
  }
>() {}

// AuthorizationService implementation
export const AuthorizationServiceLive = Layer.succeed(
  AuthorizationService,
  {
    checkPermission: (subject: Subject, resource: Resource, action: Permission) => {
      // Check ACL (Access Control List) first
      if (resource.acl) {
        // Use type assertion to handle the permission as a valid ACL key
        const aclRead = resource.acl.read
        const aclWrite = resource.acl.write
        const aclDelete = resource.acl.delete

        if (
          action === "read" && aclRead && (aclRead.includes(subject.id) ||
            subject.roles.some((role) => aclRead.includes(role)))
        ) {
          return Effect.succeed(true)
        }

        if (
          action === "write" && aclWrite && (aclWrite.includes(subject.id) ||
            subject.roles.some((role) => aclWrite.includes(role)))
        ) {
          return Effect.succeed(true)
        }

        if (
          action === "delete" && aclDelete && (aclDelete.includes(subject.id) ||
            subject.roles.some((role) => aclDelete.includes(role)))
        ) {
          return Effect.succeed(true)
        }
      }

      // Check if subject is the owner (for non-admin actions)
      if (resource.owner && resource.owner === subject.id && action !== "admin") {
        return Effect.succeed(true)
      }

      // Check if subject has admin permission
      if (subject.permissions.includes("admin")) {
        return Effect.succeed(true)
      }

      // Check user's direct permissions
      if (subject.permissions.includes(action)) {
        return Effect.succeed(true)
      }

      // Default: deny access
      return Effect.succeed(false)
    },
    addPolicy: (policy: AuthorizationPolicy) => Effect.void,
    removePolicy: (policyId: string) => Effect.void
  }
)

export const LocalFirstLive = (config: LocalFirstConfig) =>
  Layer.effect(
    LocalFirst,
    Effect.gen(function*() {
      const storage = yield* StorageService
      const sync = yield* SyncService
      const hubService = yield* HubService
      const vectorClock = yield* Ref.make(VectorClock.empty())
      let authorizationService: AuthorizationService | undefined = undefined
      // Initialize authorization service if enabled
      if (config.authorization?.enabled) {
        authorizationService = yield* AuthorizationService
      }
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

        // Server reconciliation background process - run less frequently than regular sync
        const reconciliationInterval = config.autoSyncInterval * 5 // 5x the regular sync interval
        yield* Effect.fork(
          Effect.repeat(
            performReconciliation(storage, vectorClock, config.replicaId),
            Schedule.spaced(reconciliationInterval)
          )
        )
      }
      const result: {
        config: LocalFirstConfig
        storage: StorageService
        sync: SyncService
        hubService: HubService
        vectorClock: Ref.Ref<VectorClock>
        authorizationService?: AuthorizationService
      } = {
        config,
        storage: storage as StorageService,
        sync: sync as SyncService,
        hubService: hubService as HubService,
        vectorClock
      }

      if (authorizationService) {
        result.authorizationService = authorizationService
      }

      return result
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
    Layer.provide(HubServiceLive),
    Layer.provide(AuthorizationServiceLive)
  )

// Collection API with authorization
// Utility functions for common Collection operations
const getOrCreateEmpty = <T>(
  getter: Effect.Effect<T, LocalFirstError, StorageService>,
  emptyFactory: () => T
): Effect.Effect<T, LocalFirstError, StorageService> => {
  return getter.pipe(
    Effect.catchAll(() => Effect.succeed(emptyFactory()))
  )
}

const setWithSync = <T>(
  collection: Collection<T>,
  value: T
): Effect.Effect<void, LocalFirstError, StorageService | SyncService | LocalFirst> => {
  return Effect.gen(function*() {
    const storage = yield* StorageService
    const sync = yield* SyncService
    const localFirst = yield* LocalFirst
    const vectorClock = localFirst.vectorClock

    // Update local storage
    yield* storage.set(collection["name"], value)

    // Create sync operation
    const clock = yield* Ref.get(vectorClock)
    const newClock = clock.increment(localFirst.config.replicaId)
    yield* Ref.set(vectorClock, newClock)
    const operation = {
      id: Math.random().toString(36).slice(2, 11),
      type: "set" as const,
      key: collection["name"],
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
    return setWithSync(this, value)
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
      const localFirst = yield* LocalFirst
      const current = yield* self.get().pipe(
        Effect.catchAll(() => Effect.succeed(LWWRegister.make(value, localFirst.config.replicaId)))
      )
      const updated = current.set(value, localFirst.config.replicaId)
      yield* setWithSync(self, updated)
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
      const current = yield* getOrCreateEmpty(
        self.get(),
        () => GSet.empty<A>()
      )
      const updated = current.add(element)
      yield* setWithSync(self, updated)
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
      const current = yield* getOrCreateEmpty(
        self.get(),
        () => ORMap.empty<A>()
      )
      const updated = current.put(key, value)
      yield* setWithSync(self, updated)
    })
  }

  remove(key: string): Effect.Effect<void, LocalFirstError, StorageService | SyncService | LocalFirst> {
    const self = this
    return Effect.gen(function*() {
      const current = yield* getOrCreateEmpty(
        self.get(),
        () => ORMap.empty<A>()
      )
      const updated = current.remove(key)
      yield* setWithSync(self, updated)
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

// TwoPhaseSet with tombstones Collection
export class TwoPhaseSetCollection<A> extends Collection<TwoPhaseSet<A>> {
  constructor(name: string) {
    super(name)
  }

  add(element: A): Effect.Effect<void, LocalFirstError, StorageService | SyncService | LocalFirst> {
    const self = this
    return Effect.gen(function*() {
      const current = yield* getOrCreateEmpty(
        self.get(),
        () => TwoPhaseSet.empty<A>()
      )
      const updated = current.add(element)
      yield* setWithSync(self, updated)
    })
  }

  remove(element: A): Effect.Effect<void, LocalFirstError, StorageService | SyncService | LocalFirst> {
    const self = this
    return Effect.gen(function*() {
      const current = yield* getOrCreateEmpty(
        self.get(),
        () => TwoPhaseSet.empty<A>()
      )
      const updated = current.remove(element)
      yield* setWithSync(self, updated)
    })
  }

  values(): Effect.Effect<ReadonlyArray<A>, LocalFirstError, StorageService> {
    return this.get().pipe(Effect.map((set) => set.values()))
  }

  has(element: A): Effect.Effect<boolean, LocalFirstError, StorageService> {
    return this.get().pipe(Effect.map((set) => set.has(element)))
  }
}

// OrderedSet with tombstones Collection
export class OrderedSetCollection<A> extends Collection<OrderedSet<A>> {
  constructor(name: string) {
    super(name)
  }

  add(
    id: string,
    value: A
  ): Effect.Effect<void, LocalFirstError, StorageService | SyncService | LocalFirst> {
    const self = this
    return Effect.gen(function*() {
      const localFirst = yield* LocalFirst
      const current = yield* getOrCreateEmpty(
        self.get(),
        () => OrderedSet.empty<A>()
      )
      const updated = current.add(id, value, Date.now(), localFirst.config.replicaId)
      yield* setWithSync(self, updated)
    })
  }

  remove(
    id: string
  ): Effect.Effect<void, LocalFirstError, StorageService | SyncService | LocalFirst> {
    const self = this
    return Effect.gen(function*() {
      const current = yield* getOrCreateEmpty(
        self.get(),
        () => OrderedSet.empty<A>()
      )
      const updated = current.remove(id)
      yield* setWithSync(self, updated)
    })
  }

  getForKey(id: string): Effect.Effect<A | undefined, LocalFirstError, StorageService> {
    return this.get().pipe(Effect.map((set) => set.get(id)))
  }

  values(): Effect.Effect<Array<{ id: string; value: A }>, LocalFirstError, StorageService> {
    return this.get().pipe(Effect.map((set) => set.values()))
  }

  has(id: string): Effect.Effect<boolean, LocalFirstError, StorageService> {
    return this.get().pipe(Effect.map((set) => set.has(id)))
  }
}

// PNCounter Collection
export class PNCounterCollection extends Collection<PNCounter> {
  constructor(name: string) {
    super(name)
  }

  increment(
    by: number = 1
  ): Effect.Effect<void, LocalFirstError, StorageService | SyncService | LocalFirst> {
    const self = this
    return Effect.gen(function*() {
      const localFirst = yield* LocalFirst
      const current = yield* getOrCreateEmpty(
        self.get(),
        () => PNCounter.empty()
      )
      const updated = current.increment(localFirst.config.replicaId, by)
      yield* setWithSync(self, updated)
    })
  }

  decrement(
    by: number = 1
  ): Effect.Effect<void, LocalFirstError, StorageService | SyncService | LocalFirst> {
    const self = this
    return Effect.gen(function*() {
      const localFirst = yield* LocalFirst
      const current = yield* getOrCreateEmpty(
        self.get(),
        () => PNCounter.empty()
      )
      const updated = current.decrement(localFirst.config.replicaId, by)
      yield* setWithSync(self, updated)
    })
  }

  value(): Effect.Effect<number, LocalFirstError, StorageService> {
    return this.get().pipe(Effect.map((counter) => counter.value()))
  }
}

// RGA (Replicated Growable Array) Collection
export class RGACollection<A> extends Collection<RGA<A>> {
  constructor(name: string) {
    super(name)
  }

  append(
    value: A
  ): Effect.Effect<void, LocalFirstError, StorageService | SyncService | LocalFirst> {
    const self = this
    return Effect.gen(function*() {
      const localFirst = yield* LocalFirst
      const current = yield* getOrCreateEmpty(
        self.get(),
        () => RGA.empty<A>()
      )
      const updated = current.append(value, localFirst.config.replicaId)
      yield* setWithSync(self, updated)
    })
  }

  insertAt(
    index: number,
    value: A
  ): Effect.Effect<void, LocalFirstError, StorageService | SyncService | LocalFirst> {
    const self = this
    return Effect.gen(function*() {
      const localFirst = yield* LocalFirst
      const current = yield* getOrCreateEmpty(
        self.get(),
        () => RGA.empty<A>()
      )
      const updated = current.insertAt(index, value, localFirst.config.replicaId)
      yield* setWithSync(self, updated)
    })
  }

  removeAt(
    index: number
  ): Effect.Effect<void, LocalFirstError, StorageService | SyncService | LocalFirst> {
    const self = this
    return Effect.gen(function*() {
      const current = yield* getOrCreateEmpty(
        self.get(),
        () => RGA.empty<A>()
      )
      const updated = current.removeAt(index)
      yield* setWithSync(self, updated)
    })
  }

  at(index: number): Effect.Effect<A | undefined, LocalFirstError, StorageService> {
    return this.get().pipe(Effect.map((array) => array.get(index)))
  }

  length(): Effect.Effect<number, LocalFirstError, StorageService> {
    return this.get().pipe(Effect.map((array) => array.length))
  }

  toArray(): Effect.Effect<Array<A>, LocalFirstError, StorageService> {
    return this.get().pipe(Effect.map((array) => array.toArray()))
  }
}

// Helper function to apply sync operations with server reconciliation awareness
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
      } else if (operation.type === "reconcile") {
        // Handle reconciliation operations - apply server state updates
        if (operation.serverClock) {
          yield* Ref.set(vectorClock, operation.serverClock)
        }
      }
      yield* Ref.set(vectorClock, operation.vectorClock)
    }
  })

// Server reconciliation function - handles conflicts between client and server state
const performReconciliation = (
  storage: StorageService,
  vectorClock: Ref.Ref<VectorClock>,
  replicaId: string
): Effect.Effect<void, LocalFirstError, StorageService | SyncService> =>
  Effect.gen(function*() {
    const sync = yield* SyncService
    const operations = yield* sync.pull()
    const currentClock = yield* Ref.get(vectorClock)

    // Prepare reconciliation request
    const reconciliationRequest: ReconciliationRequest = {
      id: Math.random().toString(36).slice(2, 11),
      operations, // Operations that the client has locally that may need reconciliation
      clientState: currentClock,
      replicaId,
      timestamp: Date.now()
    }

    // Perform reconciliation with server
    const response = yield* sync.reconcile(reconciliationRequest).pipe(
      Effect.catchTag("SyncError", (error) =>
        Effect.succeed<ReconciliationResponse>({
          id: reconciliationRequest.id,
          status: "accepted",
          resolvedState: currentClock
        }))
    )

    // Apply any server operations that came back from reconciliation
    if (response.serverOperations) {
      yield* applyOperations(response.serverOperations, storage, vectorClock, replicaId)
    }

    // Update local vector clock to resolved state if provided
    if (response.resolvedState) {
      yield* Ref.set(vectorClock, response.resolvedState)
    }

    // Handle any conflicts reported by server
    if (response.conflicts) {
      for (const conflict of response.conflicts) {
        if (conflict.resolution === "server") {
          // Apply server value
          yield* (storage as StorageBackend).set(conflict.key, conflict.serverValue).pipe(
            Effect.catchAll((error) =>
              Effect.fail(new StorageError({ message: `Failed to resolve conflict for ${conflict.key}`, cause: error }))
            )
          )
        } else if (conflict.resolution === "merge") {
          // Attempt to merge values (this would require custom logic per CRDT type)
          // For now, we'll default to server value, but in a real system this would depend on the CRDT type
          yield* (storage as StorageBackend).set(conflict.key, conflict.serverValue).pipe(
            Effect.catchAll((error) =>
              Effect.fail(
                new StorageError({ message: `Failed to resolve merge conflict for ${conflict.key}`, cause: error })
              )
            )
          )
        }
      }
    }
  })
