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

/**
 * Authorization and Access Control Types
 */

/**
 * Type representing the different permissions available in the system.
 */
export type Permission =
  /** Permission to read resources */
  | "read"
  /** Permission to write/update resources */
  | "write"
  /** Permission to delete resources */
  | "delete"
  /** Administrative permissions */
  | "admin"

/**
 * Interface representing a subject (user, service, or system) that can perform actions.
 */
export interface Subject {
  /** Unique identifier for the subject */
  readonly id: string
  /** Type of the subject (user, service, or system) */
  readonly type: "user" | "service" | "system"
  /** Roles assigned to the subject */
  readonly roles: Array<string>
  /** Permissions assigned to the subject */
  readonly permissions: Array<Permission>
}

/**
 * Interface representing a resource that can be accessed by subjects.
 */
export interface Resource {
  /** Unique identifier for the resource */
  readonly id: string
  /** Type of the resource */
  readonly type: string
  /** Optional owner of the resource */
  readonly owner?: string
  /** Optional access control list (ACL) for the resource */
  readonly acl?: {
    /** User IDs or role IDs with read access */
    readonly read?: Array<string>
    /** User IDs or role IDs with write access */
    readonly write?: Array<string>
    /** User IDs or role IDs with delete access */
    readonly delete?: Array<string>
  }
}

/**
 * Interface representing an authorization policy.
 */
export interface AuthorizationPolicy {
  /** Unique identifier for the policy */
  readonly id: string
  /** Type of resource this policy applies to */
  readonly resourceType: string
  /** Conditions that determine if the policy applies */
  readonly conditions: Array<(subject: Subject, resource: Resource, action: Permission) => boolean>
  /** Whether the policy allows or denies access */
  readonly effect: "allow" | "deny"
  /** Priority of the policy (higher priority policies are evaluated first) */
  readonly priority: number
}

/**
 * Interface for authorization service that manages permissions and policies.
 */
export interface AuthorizationService {
  /**
   * Checks if a subject has permission to perform an action on a resource.
   * @param subject - The subject requesting access
   * @param resource - The resource being accessed
   * @param action - The action being performed
   * @returns Effect that resolves to true if access is allowed, false otherwise
   */
  readonly checkPermission: (
    subject: Subject,
    resource: Resource,
    action: Permission
  ) => Effect.Effect<boolean, never, never>
  /**
   * Adds a new authorization policy.
   * @param policy - The policy to add
   * @returns Effect that completes when the policy is added
   */
  readonly addPolicy: (policy: AuthorizationPolicy) => Effect.Effect<void, never, never>
  /**
   * Removes an authorization policy.
   * @param policyId - The ID of the policy to remove
   * @returns Effect that completes when the policy is removed
   */
  readonly removePolicy: (policyId: string) => Effect.Effect<void, never, never>
}

/**
 * Context tag for the AuthorizationService.
 */
export const AuthorizationService = Context.GenericTag<AuthorizationService>("AuthorizationService")

/**
 * Business logic hooks for read/write operations.
 * These hooks allow custom logic to be executed before and after storage operations.
 */
export interface BusinessLogicHook {
  /**
   * Hook executed before a read operation.
   * @param key - The key being read
   * @param currentValue - The current value associated with the key
   * @returns The transformed value or an error
   */
  readonly beforeRead?: (key: string, currentValue: unknown) => Effect.Effect<unknown, LocalFirstError, never>
  /**
   * Hook executed after a successful read operation.
   * @param key - The key that was read
   * @param value - The value that was read
   * @returns The transformed value or an error
   */
  readonly afterRead?: (key: string, value: unknown) => Effect.Effect<unknown, LocalFirstError, never>
  /**
   * Hook executed before a write operation.
   * @param key - The key being written to
   * @param newValue - The new value to write
   * @param currentValue - The current value associated with the key (if any)
   * @returns The transformed value to write or an error
   */
  readonly beforeWrite?: (
    key: string,
    newValue: unknown,
    currentValue?: unknown
  ) => Effect.Effect<unknown, LocalFirstError, never>
  /**
   * Hook executed after a successful write operation.
   * @param key - The key that was written to
   * @param newValue - The value that was written
   * @returns Effect that completes after the write operation
   */
  readonly afterWrite?: (key: string, newValue: unknown) => Effect.Effect<void, LocalFirstError, never>
  /**
   * Validation hook to check if a value is valid for a given key.
   * @param key - The key to validate against
   * @param value - The value to validate
   * @returns Effect that resolves to true if the value is valid, false otherwise
   */
  readonly validation?: (key: string, value: unknown) => Effect.Effect<boolean, LocalFirstError, never>
}

/**
 * Configuration interface for the LocalFirst framework.
 */
export interface LocalFirstConfig {
  /** Storage backend to use (IndexedDB or in-memory) */
  readonly storage: "indexeddb" | "memory"
  /** Sync strategy to use (WebSocket or manual) */
  readonly sync: "websocket" | "manual"
  /** URL for WebSocket synchronization (required if sync is "websocket") */
  readonly syncUrl?: string
  /** Unique identifier for this replica in the distributed system */
  readonly replicaId: string
  /** Interval in milliseconds for automatic synchronization (optional) */
  readonly autoSyncInterval?: number
  /** Authorization configuration (optional) */
  readonly authorization?: {
    /** Whether authorization is enabled */
    readonly enabled: boolean
    /** Default subject to use if no subject is provided */
    readonly defaultSubject?: Subject
  }
  /** Business logic configuration (optional) */
  readonly businessLogic?: {
    /** Global business logic hook to apply to all operations */
    readonly globalHook?: BusinessLogicHook
    /** Collection-specific business logic hooks */
    readonly collectionHooks?: Record<string, BusinessLogicHook>
  }
}

/**
 * Context tag for the LocalFirst service.
 */
export class LocalFirst extends Context.Tag("@core/LocalFirst")<
  LocalFirst,
  {
    /** Configuration for the LocalFirst instance */
    readonly config: LocalFirstConfig
    /** Storage service for data persistence */
    readonly storage: StorageService
    /** Sync service for data synchronization */
    readonly sync: SyncService
    /** Hub service for messaging */
    readonly hub: HubService
    /** Vector clock for tracking causality */
    readonly vectorClock: Ref.Ref<VectorClock>
    /** Optional authorization service */
    readonly authorizationService?: AuthorizationService
  }
>() {}

/**
 * Live implementation of the AuthorizationService.
 * Provides a concrete implementation of authorization checks using ACL, ownership, and permissions.
 */
export const AuthorizationServiceLive = Layer.succeed(
  AuthorizationService,
  {
    /**
     * Checks if a subject has permission to perform an action on a resource.
     * The check follows this order: ACL check, ownership check, admin permissions, direct permissions.
     * @param subject - The subject requesting access
     * @param resource - The resource being accessed
     * @param action - The action being performed
     * @returns Effect that resolves to true if access is allowed, false otherwise
     */
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
    /**
     * Adds a new authorization policy.
     * Currently a no-op in this implementation.
     * @param policy - The policy to add
     * @returns Effect that completes immediately
     */
    addPolicy: (policy: AuthorizationPolicy) => Effect.void,
    /**
     * Removes an authorization policy.
     * Currently a no-op in this implementation.
     * @param policyId - The ID of the policy to remove
     * @returns Effect that completes immediately
     */
    removePolicy: (policyId: string) => Effect.void
  }
)

/**
 * Creates a live layer for the LocalFirst framework with the given configuration.
 * This layer provides all necessary services (storage, sync, hub, etc.) and sets up background processes.
 * @param config - Configuration for the LocalFirst instance
 * @returns A Layer that provides a LocalFirst instance
 */
export const LocalFirstLive = (config: LocalFirstConfig) =>
  Layer.effect(
    LocalFirst,
    Effect.gen(function*() {
      const storage = yield* StorageService
      const sync = yield* SyncService
      const hub = yield* HubService
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
        hub: HubService
        vectorClock: Ref.Ref<VectorClock>
        authorizationService?: AuthorizationService
      } = {
        config,
        storage,
        sync,
        hub,
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

/**
 * Base class for collections in the LocalFirst framework.
 * Provides basic operations for data storage, retrieval, and synchronization.
 * @template A - The type of data stored in the collection
 */
export class Collection<A> {
  /**
   * Creates a new Collection instance with the specified name.
   * @param name - The name of the collection used for storage and retrieval
   */
  constructor(
    readonly name: string
  ) {}

  /**
   * Creates a new Hub through the LocalFirst framework.
   * Hubs provide publish-subscribe messaging capabilities.
   * @template T - The type of messages in the hub
   * @param strategy - Optional strategy for the hub (unbounded by default)
   * @returns Effect that resolves to a Hub instance
   */
  createHub<T>(
    strategy?: HubStrategy
  ): Effect.Effect<Hub<T>, LocalFirstError, HubService> {
    return Effect.gen(function*() {
      const hub = yield* HubService
      return yield* hub.createHub<T>(strategy)
    })
  }

  /**
   * Gets the current value of the collection from storage.
   * @returns Effect that resolves to the current value of the collection
   */
  get(): Effect.Effect<A, LocalFirstError, StorageService> {
    const self = this
    return Effect.gen(function*() {
      const storage = yield* StorageService
      return yield* storage.get(self.name).pipe(
        Effect.map((data) => data as A)
      )
    })
  }

  /**
   * Sets the value of the collection and synchronizes it across replicas.
   * @param value - The value to set in the collection
   * @returns Effect that completes when the value is set and synchronized
   */
  set(value: A): Effect.Effect<void, LocalFirstError, StorageService | SyncService | LocalFirst> {
    return setWithSync(this, value)
  }

  /**
   * Creates a stream that watches for changes to the collection.
   * @returns A Stream that emits new values when the collection changes
   */
  watch(): Stream.Stream<A, LocalFirstError, StorageService> {
    const self = this
    return Stream.unwrapScoped(
      Effect.map(StorageService, (storage) => storage.watch(self.name))
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

/**
 * CRDT Collections
 */

/**
 * Collection class for Last-Write-Wins Register (LWW-Register).
 * This collection provides a value that is updated using a timestamp-based conflict resolution.
 * @template A - The type of value stored in the register
 */
export class LWWRegisterCollection<A> extends Collection<LWWRegister<A>> {
  /**
   * Creates a new LWWRegisterCollection with the specified name.
   * @param name - The name of the collection
   */
  constructor(name: string) {
    super(name)
  }

  /**
   * Sets a new value in the LWW register and synchronizes it across replicas.
   * @param value - The value to set in the register
   * @returns Effect that completes when the value is set and synchronized
   */
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

  /**
   * Gets the current value from the LWW register.
   * @returns Effect that resolves to the current value in the register
   */
  getValue(): Effect.Effect<A, LocalFirstError, StorageService> {
    return this.get().pipe(Effect.map((register) => register.get()))
  }
}

/**
 * Collection class for Grow-Only Set (G-Set).
 * This collection allows adding elements but never removing them, with merge semantics that combine all added elements.
 * @template A - The type of elements stored in the set
 */
export class GSetCollection<A> extends Collection<GSet<A>> {
  /**
   * Creates a new GSetCollection with the specified name.
   * @param name - The name of the collection
   */
  constructor(name: string) {
    super(name)
  }

  /**
   * Adds an element to the G-Set and synchronizes it across replicas.
   * @param element - The element to add to the set
   * @returns Effect that completes when the element is added and synchronized
   */
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

  /**
   * Gets all elements currently in the G-Set.
   * @returns Effect that resolves to a readonly array of all elements in the set
   */
  values(): Effect.Effect<ReadonlyArray<A>, LocalFirstError, StorageService> {
    return this.get().pipe(Effect.map((set) => set.values()))
  }

  /**
   * Checks if an element exists in the G-Set.
   * @param element - The element to check for
   * @returns Effect that resolves to true if the element exists in the set, false otherwise
   */
  has(element: A): Effect.Effect<boolean, LocalFirstError, StorageService> {
    return this.get().pipe(Effect.map((set) => set.has(element)))
  }
}

/**
 * Collection class for Observed-Remove Map (OR-Map).
 * This collection allows adding and removing key-value pairs with sophisticated conflict resolution.
 * @template A - The type of values stored in the map
 */
export class ORMapCollection<A> extends Collection<ORMap<A>> {
  /**
   * Creates a new ORMapCollection with the specified name.
   * @param name - The name of the collection
   */
  constructor(name: string) {
    super(name)
  }

  /**
   * Adds or updates a key-value pair in the OR-Map and synchronizes it across replicas.
   * @param key - The key to add or update
   * @param value - The value to associate with the key
   * @returns Effect that completes when the key-value pair is added and synchronized
   */
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

  /**
   * Removes a key-value pair from the OR-Map and synchronizes it across replicas.
   * @param key - The key to remove
   * @returns Effect that completes when the key-value pair is removed and synchronized
   */
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

  /**
   * Gets the value associated with a key in the OR-Map.
   * @param key - The key to get the value for
   * @returns Effect that resolves to an Option containing the value if it exists, or None
   */
  getForKey(key: string): Effect.Effect<Option.Option<A>, LocalFirstError, StorageService> {
    const self = this
    return Effect.gen(function*() {
      const map = yield* self.get()
      return map.get(key)
    })
  }

  /**
   * Gets all key-value pairs in the OR-Map as a record.
   * @returns Effect that resolves to a readonly record of all key-value pairs
   */
  entries(): Effect.Effect<Readonly<Record<string, A>>, LocalFirstError, StorageService> {
    return this.get().pipe(Effect.map((map) => map.toRecord()))
  }
}

/**
 * Collection class for Two-Phase Set (2P-Set).
 * This collection allows adding and removing elements, but once an element is removed, it cannot be re-added.
 */
export class TwoPhaseSetCollection<A> extends Collection<TwoPhaseSet<A>> {
  /**
   * Creates a new TwoPhaseSetCollection with the specified name.
   * @param name - The name of the collection
   */
  constructor(name: string) {
    super(name)
  }

  /**
   * Adds an element to the Two-Phase Set and synchronizes it across replicas.
   * @param element - The element to add to the set
   * @returns Effect that completes when the element is added and synchronized
   */
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

  /**
   * Removes an element from the Two-Phase Set and synchronizes it across replicas.
   * @param element - The element to remove from the set
   * @returns Effect that completes when the element is removed and synchronized
   */
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

  /**
   * Gets all elements currently in the Two-Phase Set.
   * @returns Effect that resolves to a readonly array of all elements in the set
   */
  values(): Effect.Effect<ReadonlyArray<A>, LocalFirstError, StorageService> {
    return this.get().pipe(Effect.map((set) => set.values()))
  }

  /**
   * Checks if an element exists in the Two-Phase Set.
   * @param element - The element to check for
   * @returns Effect that resolves to true if the element exists in the set, false otherwise
   */
  has(element: A): Effect.Effect<boolean, LocalFirstError, StorageService> {
    return this.get().pipe(Effect.map((set) => set.has(element)))
  }
}

/**
 * Collection class for Ordered Set with tombstones.
 * This collection maintains ordering and allows element removal with tombstones.
 */
export class OrderedSetCollection<A> extends Collection<OrderedSet<A>> {
  /**
   * Creates a new OrderedSetCollection with the specified name.
   * @param name - The name of the collection
   */
  constructor(name: string) {
    super(name)
  }

  /**
   * Adds an element with a unique ID to the Ordered Set and synchronizes it across replicas.
   * @param id - Unique identifier for the element
   * @param value - The value to store
   * @returns Effect that completes when the element is added and synchronized
   */
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

  /**
   * Removes an element by its ID from the Ordered Set and synchronizes it across replicas.
   * @param id - The unique identifier of the element to remove
   * @returns Effect that completes when the element is removed and synchronized
   */
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

  /**
   * Gets the value of an element by its ID in the Ordered Set.
   * @param id - The unique identifier of the element to get
   * @returns Effect that resolves to the value of the element if it exists, or undefined
   */
  getForKey(id: string): Effect.Effect<A | undefined, LocalFirstError, StorageService> {
    return this.get().pipe(Effect.map((set) => set.get(id)))
  }

  /**
   * Gets all elements currently in the Ordered Set, sorted by timestamp and replica ID.
   * @returns Effect that resolves to an array of objects containing element IDs and values
   */
  values(): Effect.Effect<Array<{ id: string; value: A }>, LocalFirstError, StorageService> {
    return this.get().pipe(Effect.map((set) => set.values()))
  }

  /**
   * Checks if an element exists in the Ordered Set.
   * @param id - The unique identifier of the element to check for
   * @returns Effect that resolves to true if the element exists in the set, false otherwise
   */
  has(id: string): Effect.Effect<boolean, LocalFirstError, StorageService> {
    return this.get().pipe(Effect.map((set) => set.has(id)))
  }
}

/**
 * Collection class for Positive-Negative Counter (PN-Counter).
 * This collection maintains a counter that supports both increment and decrement operations.
 */
export class PNCounterCollection extends Collection<PNCounter> {
  /**
   * Creates a new PNCounterCollection with the specified name.
   * @param name - The name of the collection
   */
  constructor(name: string) {
    super(name)
  }

  /**
   * Increments the counter by a specified amount and synchronizes it across replicas.
   * @param by - The amount to increment by (default is 1)
   * @returns Effect that completes when the counter is incremented and synchronized
   */
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

  /**
   * Decrements the counter by a specified amount and synchronizes it across replicas.
   * @param by - The amount to decrement by (default is 1)
   * @returns Effect that completes when the counter is decremented and synchronized
   */
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

  /**
   * Gets the current value of the counter.
   * @returns Effect that resolves to the current counter value
   */
  value(): Effect.Effect<number, LocalFirstError, StorageService> {
    return this.get().pipe(Effect.map((counter) => counter.value()))
  }
}

/**
 * Collection class for Replicated Growable Array (RGA).
 * This collection provides an array-like structure with concurrent operations on elements.
 */
export class RGACollection<A> extends Collection<RGA<A>> {
  /**
   * Creates a new RGACollection with the specified name.
   * @param name - The name of the collection
   */
  constructor(name: string) {
    super(name)
  }

  /**
   * Appends an element to the end of the array and synchronizes it across replicas.
   * @param value - The value to append to the array
   * @returns Effect that completes when the element is appended and synchronized
   */
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

  /**
   * Inserts an element at a specific index in the array and synchronizes it across replicas.
   * @param index - The index at which to insert the element
   * @param value - The value to insert
   * @returns Effect that completes when the element is inserted and synchronized
   */
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

  /**
   * Removes an element at a specific index from the array and synchronizes it across replicas.
   * @param index - The index of the element to remove
   * @returns Effect that completes when the element is removed and synchronized
   */
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

  /**
   * Gets the element at a specific index in the array.
   * @param index - The index of the element to get
   * @returns Effect that resolves to the element at the specified index, or undefined if index is out of bounds
   */
  at(index: number): Effect.Effect<A | undefined, LocalFirstError, StorageService> {
    return this.get().pipe(Effect.map((array) => array.get(index)))
  }

  /**
   * Gets the length of the array.
   * @returns Effect that resolves to the number of elements in the array
   */
  length(): Effect.Effect<number, LocalFirstError, StorageService> {
    return this.get().pipe(Effect.map((array) => array.length))
  }

  /**
   * Converts the RGA to a regular array in logical order.
   * @returns Effect that resolves to an array containing all elements in the RGA, sorted by logical position
   */
  toArray(): Effect.Effect<Array<A>, LocalFirstError, StorageService> {
    return this.get().pipe(Effect.map((array) => array.toArray()))
  }
}

/**
 * Helper function to apply sync operations with server reconciliation awareness.
 * This function processes incoming operations from other replicas or the server,
 * applying them to the local storage after checking causality with the vector clock.
 * @param operations - Array of sync operations to apply
 * @param storage - The local storage service to apply operations to
 * @param vectorClock - The vector clock reference to update
 * @param replicaId - The replica ID of the local instance
 * @returns Effect that completes when all operations are applied
 */
const applyOperations = (
  operations: Array<SyncOperation>,
  storage: StorageService,
  vectorClock: Ref.Ref<VectorClock>,
  replicaId: string
): Effect.Effect<void, LocalFirstError, never> =>
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
          Effect.mapError((error) => new StorageError({ message: "Failed to set operation", cause: error }))
        )
      } else if (operation.type === "delete") {
        yield* backend.delete(operation.key).pipe(
          Effect.mapError((error) => new StorageError({ message: "Failed to delete operation", cause: error }))
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

/**
 * Server reconciliation function - handles conflicts between client and server state.
 * This function performs synchronization with a central server, resolving conflicts
 * and updating the local state based on server responses.
 * @param storage - The local storage service
 * @param vectorClock - The vector clock reference to update
 * @param replicaId - The replica ID of the local instance
 * @returns Effect that completes when reconciliation is finished
 */
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
            Effect.mapError((
              error
            ) => new StorageError({ message: `Failed to resolve conflict for ${conflict.key}`, cause: error }))
          )
        } else if (conflict.resolution === "merge") {
          // Attempt to merge values (this would require custom logic per CRDT type)
          // For now, we'll default to server value, but in a real system this would depend on the CRDT type
          yield* (storage as StorageBackend).set(conflict.key, conflict.serverValue).pipe(
            Effect.mapError((error) =>
              new StorageError({ message: `Failed to resolve merge conflict for ${conflict.key}`, cause: error })
            )
          )
        }
      }
    }
  })
