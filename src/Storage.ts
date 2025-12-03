import { Chunk, Context, Effect, Layer, Option as EffectOption, Stream } from "effect"
import { StorageError } from "./Errors.js"

/**
 * Data model interface for different storage systems.
 * Defines how data is serialized to and deserialized from bytes.
 */
export interface DataModel {
  /**
   * Serializes a value to a Uint8Array.
   * @param value - The value to serialize
   * @returns The serialized data as a Uint8Array
   */
  serialize(value: unknown): Uint8Array
  /**
   * Deserializes data from a Uint8Array to a typed value.
   * @template T - The type to deserialize to
   * @param data - The serialized data as a Uint8Array
   * @returns The deserialized value
   */
  deserialize<T>(data: Uint8Array): T
}

/**
 * Default JSON data model that serializes/deserializes using JSON.
 */
export const JsonDataModel: DataModel = {
  /**
   * Serializes a value to JSON and then to a Uint8Array.
   * @param value - The value to serialize
   * @returns The serialized data as a Uint8Array
   */
  serialize: (value: unknown) => {
    return new TextEncoder().encode(JSON.stringify(value))
  },
  /**
   * Deserializes a Uint8Array containing JSON data to a typed value.
   * @template T - The type to deserialize to
   * @param data - The serialized JSON data as a Uint8Array
   * @returns The deserialized value
   */
  deserialize: <T>(data: Uint8Array) => {
    return JSON.parse(new TextDecoder().decode(data)) as T
  }
}

/**
 * Query interface for different database types.
 * Provides a way to express different types of queries against storage.
 */
export interface StorageQuery {
  /** The type of query to perform */
  readonly type: "range" | "filter" | "aggregate" | "custom"
  /** Parameters for the query */
  readonly params: Record<string, unknown>
}

/**
 * Configuration for different database types.
 * Defines how to connect to and configure different storage backends.
 */
export interface DatabaseConfig {
  /** The type of database to use */
  readonly type: "indexeddb" | "sqlite" | "redis" | "postgres" | "custom"
  /** Configuration options specific to the database type */
  readonly options: Record<string, unknown>
  /** Optional data model to use for serialization/deserialization */
  readonly dataModel?: DataModel
}

/**
 * Basic storage backend interface.
 * Defines the core operations that any storage backend must implement.
 */
export interface StorageBackend {
  /**
   * Gets a value by key from storage.
   * @param key - The key to retrieve
   * @returns Effect that resolves to the value or a StorageError
   */
  readonly get: (key: string) => Effect.Effect<unknown, StorageError>
  /**
   * Sets a value by key in storage.
   * @param key - The key to set
   * @param value - The value to store
   * @returns Effect that completes when the value is set or a StorageError
   */
  readonly set: (key: string, value: unknown) => Effect.Effect<void, StorageError>
  /**
   * Deletes a key-value pair from storage.
   * @param key - The key to delete
   * @returns Effect that completes when the key is deleted or a StorageError
   */
  readonly delete: (key: string) => Effect.Effect<void, StorageError>
  /**
   * Clears all key-value pairs from storage.
   * @returns Effect that completes when storage is cleared or a StorageError
   */
  readonly clear: () => Effect.Effect<void, StorageError>
  /**
   * Gets all keys in storage.
   * @returns Effect that resolves to a readonly array of keys or a StorageError
   */
  readonly keys: () => Effect.Effect<ReadonlyArray<string>, StorageError>
  /**
   * Watches for changes to a specific key.
   * @param key - The key to watch for changes
   * @returns A Stream that emits updated values for the key
   */
  readonly watch: (key: string) => Stream.Stream<unknown, StorageError>
}

/**
 * Enhanced storage backend that supports custom data models.
 * Extends the basic StorageBackend with additional methods for working with raw bytes and custom models.
 */
export interface ExtendedStorageBackend extends StorageBackend {
  /**
   * Gets a value by key using a specific data model for deserialization.
   * @template T - The type of the value to retrieve
   * @param key - The key to retrieve
   * @param model - The data model to use for deserialization
   * @returns Effect that resolves to the deserialized value or a StorageError
   */
  readonly getWithModel: <T>(key: string, model: DataModel) => Effect.Effect<T, StorageError>
  /**
   * Sets a value by key using a specific data model for serialization.
   * @param key - The key to set
   * @param value - The value to store
   * @param model - The data model to use for serialization
   * @returns Effect that completes when the value is set or a StorageError
   */
  readonly setWithModel: (key: string, value: unknown, model: DataModel) => Effect.Effect<void, StorageError>
  /**
   * Gets the raw byte representation of a value by key.
   * @param key - The key to retrieve
   * @returns Effect that resolves to the raw bytes or a StorageError
   */
  readonly getRaw: (key: string) => Effect.Effect<Uint8Array, StorageError>
  /**
   * Sets a raw byte representation for a key.
   * @param key - The key to set
   * @param data - The raw bytes to store
   * @returns Effect that completes when the data is set or a StorageError
   */
  readonly setRaw: (key: string, data: Uint8Array) => Effect.Effect<void, StorageError>
  /**
   * Executes a storage query.
   * @param query - The query to execute
   * @returns Effect that resolves to an array of results or a StorageError
   */
  readonly query: (query: StorageQuery) => Effect.Effect<Array<unknown>, StorageError>
}

/**
 * Storage service interface that extends the enhanced storage backend.
 */
export interface StorageService extends ExtendedStorageBackend {}

/**
 * Context tag for the StorageService.
 */
export const StorageService = Context.GenericTag<StorageService>("@core/StorageService")

/**
 * Default data model for storage, using JSON serialization.
 */
const defaultDataModel: DataModel = JsonDataModel

/**
 * Layer providing IndexedDB implementation of the StorageService.
 * This implementation persists data in the browser's IndexedDB.
 */
export const IndexedDBLive = Layer.scoped(
  StorageService,
  Effect.gen(function*() {
    const openDB = Effect.tryPromise({
      try: () =>
        new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("LocalFirstDB", 1)
          request.onerror = () => reject(request.error)
          request.onsuccess = () => resolve(request.result)
          request.onupgradeneeded = () => {
            request.result.createObjectStore("data", { keyPath: "key" })
          }
        }),
      catch: (error) =>
        new StorageError({
          message: "Failed to open IndexedDB",
          cause: error
        })
    })

    const db = yield* Effect.acquireRelease(
      openDB,
      (db) => Effect.sync(() => db.close())
    )

    const withTransaction = <A>(
      mode: IDBTransactionMode,
      operation: (store: IDBObjectStore) => IDBRequest<A>
    ): Effect.Effect<A, StorageError> =>
      Effect.async<A, StorageError>((resume) => {
        const transaction = db.transaction(["data"], mode)
        const store = transaction.objectStore("data")
        const request = operation(store)
        request.onsuccess = () => resume(Effect.succeed(request.result))
        request.onerror = () =>
          resume(
            new StorageError({
              message: "Transaction failed",
              cause: request.error
            })
          )
      })

    return {
      // Original methods
      get: (key) =>
        withTransaction("readonly", (store) => store.get(key)).pipe(
          Effect.flatMap((result) =>
            result
              ? Effect.succeed(result.value)
              : new StorageError({ message: `Key not found: ${key}` })
          )
        ),

      set: (key, value) => withTransaction("readwrite", (store) => store.put({ key, value })),

      delete: (key) => withTransaction("readwrite", (store) => store.delete(key)),

      clear: () => withTransaction("readwrite", (store) => store.clear()),

      keys: () =>
        withTransaction("readonly", (store) => store.getAllKeys()).pipe(
          Effect.map((keys) => keys.map((k) => k.toString()))
        ),

      watch: (key) =>
        Stream.async<unknown, StorageError>((emit) => {
          // Simplified watch implementation
          const interval = setInterval(async () => {
            try {
              const value = await Effect.runPromise(
                withTransaction("readonly", (store) => store.get(key))
              )
              if (value) {
                emit(Effect.succeed(Chunk.of(value.value)))
              }
            } catch (error) {
              emit(Effect.fail(EffectOption.some(error as StorageError)))
            }
          }, 1000)
          return Effect.sync(() => clearInterval(interval))
        }),

      // Extended methods
      getWithModel: <T>(key: string, model: DataModel = defaultDataModel) =>
        withTransaction("readonly", (store) => store.get(key)).pipe(
          Effect.flatMap((result) =>
            result
              ? Effect.sync(() => {
                if (result.value instanceof Uint8Array) {
                  return model.deserialize<T>(result.value)
                } else {
                  // If it's not raw bytes, assume it was stored directly
                  return result.value as T
                }
              })
              : new StorageError({ message: `Key not found: ${key}` })
          )
        ),

      setWithModel: (key: string, value: unknown, model: DataModel = defaultDataModel) =>
        Effect.gen(function*() {
          const serialized = model.serialize(value)
          return yield* withTransaction("readwrite", (store) => store.put({ key, value: serialized }))
        }),

      getRaw: (key: string) =>
        withTransaction("readonly", (store) => store.get(key)).pipe(
          Effect.flatMap((result) =>
            result
              ? Effect.sync(() => {
                if (result.value instanceof Uint8Array) {
                  return result.value
                } else {
                  // If it's not already bytes, convert to bytes using JSON model
                  return new TextEncoder().encode(JSON.stringify(result.value))
                }
              })
              : new StorageError({ message: `Key not found: ${key}` })
          )
        ),

      setRaw: (key: string, data: Uint8Array) =>
        withTransaction("readwrite", (store) => store.put({ key, value: data })),

      query: (_query: StorageQuery) => Effect.succeed([]) // Placeholder implementation for IndexedDB
    }
  })
)

/**
 * Layer providing in-memory implementation of the StorageService.
 * This implementation stores data in memory and is primarily for testing purposes.
 */
export const MemoryStorageLive = Layer.effect(
  StorageService,
  Effect.sync(() => {
    const storage = new Map<string, unknown>()
    const listeners = new Map<string, Array<(value: unknown) => void>>()

    return {
      // Original methods
      get: (key) =>
        Effect.sync(() => storage.get(key)).pipe(
          Effect.filterOrFail(
            (value) => value !== undefined,
            () => new StorageError({ message: `Key not found: ${key}` })
          )
        ),

      set: (key, value) =>
        Effect.sync(() => {
          storage.set(key, value)
          // Notify listeners
          const keyListeners = listeners.get(key) || []
          keyListeners.forEach((listener) => listener(value))
        }),

      delete: (key) =>
        Effect.sync(() => {
          storage.delete(key)
        }),

      clear: () =>
        Effect.sync(() => {
          storage.clear()
        }),

      keys: () => Effect.sync(() => Array.from(storage.keys())),

      watch: (key) =>
        Stream.async<unknown, StorageError>((emit) => {
          const listener = (value: unknown) => {
            emit(Effect.succeed(Chunk.of(value)))
          }
          if (!listeners.has(key)) {
            listeners.set(key, [])
          }
          listeners.get(key)!.push(listener)
          return Effect.sync(() => {
            const keyListeners = listeners.get(key) || []
            const index = keyListeners.indexOf(listener)
            if (index > -1) {
              keyListeners.splice(index, 1)
            }
          })
        }),

      // Extended methods
      getWithModel: <T>(key: string, model: DataModel = defaultDataModel) =>
        Effect.sync(() => storage.get(key)).pipe(
          Effect.filterOrFail(
            (value) => value !== undefined,
            () => new StorageError({ message: `Key not found: ${key}` })
          ),
          Effect.map((value) => {
            if (value instanceof Uint8Array) {
              return model.deserialize<T>(value)
            } else {
              return value as T
            }
          })
        ),

      setWithModel: (key: string, value: unknown, model: DataModel = defaultDataModel) => {
        return Effect.sync(() => {
          const serialized = model.serialize(value)
          storage.set(key, serialized)
          // Notify listeners
          const keyListeners = listeners.get(key) || []
          keyListeners.forEach((listener) => listener(serialized))
        })
      },

      getRaw: (key: string) =>
        Effect.sync(() => storage.get(key)).pipe(
          Effect.filterOrFail(
            (value) => value !== undefined,
            () => new StorageError({ message: `Key not found: ${key}` })
          ),
          Effect.map((value) => {
            if (value instanceof Uint8Array) {
              return value
            } else {
              return new TextEncoder().encode(JSON.stringify(value))
            }
          })
        ),

      setRaw: (key: string, data: Uint8Array) => {
        return Effect.sync(() => {
          storage.set(key, data)
          // Notify listeners
          const keyListeners = listeners.get(key) || []
          keyListeners.forEach((listener) => listener(data))
        })
      },

      query: (_query: StorageQuery) => Effect.succeed([]) // Placeholder for memory storage
    }
  })
)
