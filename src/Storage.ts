import { Chunk, Context, Effect, Layer, Option as EffectOption, Stream } from "effect"
import { StorageError } from "./Errors.js"

// Data model interface for different storage systems
export interface DataModel {
  serialize(value: unknown): Uint8Array
  deserialize<T>(data: Uint8Array): T
}

// Default JSON data model
export const JsonDataModel: DataModel = {
  serialize: (value: unknown) => {
    return new TextEncoder().encode(JSON.stringify(value))
  },
  deserialize: <T>(data: Uint8Array) => {
    return JSON.parse(new TextDecoder().decode(data)) as T
  }
}

// Query interface for different database types
export interface StorageQuery {
  readonly type: "range" | "filter" | "aggregate" | "custom"
  readonly params: Record<string, unknown>
}

// Configuration for different database types
export interface DatabaseConfig {
  readonly type: "indexeddb" | "sqlite" | "redis" | "postgres" | "custom"
  readonly options: Record<string, unknown>
  readonly dataModel?: DataModel
}

export interface StorageBackend {
  readonly get: (key: string) => Effect.Effect<unknown, StorageError>
  readonly set: (key: string, value: unknown) => Effect.Effect<void, StorageError>
  readonly delete: (key: string) => Effect.Effect<void, StorageError>
  readonly clear: () => Effect.Effect<void, StorageError>
  readonly keys: () => Effect.Effect<ReadonlyArray<string>, StorageError>
  readonly watch: (key: string) => Stream.Stream<unknown, StorageError>
}

// Enhanced storage backend that supports custom data models
export interface ExtendedStorageBackend extends StorageBackend {
  readonly getWithModel: <T>(key: string, model: DataModel) => Effect.Effect<T, StorageError>
  readonly setWithModel: (key: string, value: unknown, model: DataModel) => Effect.Effect<void, StorageError>
  readonly getRaw: (key: string) => Effect.Effect<Uint8Array, StorageError>
  readonly setRaw: (key: string, data: Uint8Array) => Effect.Effect<void, StorageError>
  // Support for custom storage queries
  readonly query: (query: StorageQuery) => Effect.Effect<Array<unknown>, StorageError>
}

export interface StorageService extends ExtendedStorageBackend {}
export const StorageService = Context.GenericTag<StorageService>("StorageService")

// Default data model for storage
const defaultDataModel: DataModel = JsonDataModel

// IndexedDB Implementation with extended features
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
          resume(Effect.fail(
            new StorageError({
              message: "Transaction failed",
              cause: request.error
            })
          ))
      })

    return {
      // Original methods
      get: (key) =>
        withTransaction("readonly", (store) => store.get(key)).pipe(
          Effect.flatMap((result) =>
            result
              ? Effect.succeed(result.value)
              : Effect.fail(new StorageError({ message: `Key not found: ${key}` }))
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
              : Effect.fail(new StorageError({ message: `Key not found: ${key}` }))
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
              : Effect.fail(new StorageError({ message: `Key not found: ${key}` }))
          )
        ),

      setRaw: (key: string, data: Uint8Array) =>
        withTransaction("readwrite", (store) => store.put({ key, value: data })),

      query: (query: StorageQuery) => Effect.succeed([]) // Placeholder implementation for IndexedDB
    }
  })
)

// Memory Storage for testing with extended features
export const MemoryStorageLive = Layer.effect(
  StorageService,
  Effect.sync(() => {
    const storage = new Map<string, unknown>()
    const listeners = new Map<string, Array<(value: unknown) => void>>()

    return {
      // Original methods
      get: (key) =>
        Effect.sync(() => {
          if (!storage.has(key)) {
            throw new StorageError({ message: `Key not found: ${key}` })
          }
          return storage.get(key)!
        }),

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
      getWithModel: <T>(key: string, model: DataModel = defaultDataModel) => {
        return Effect.sync(() => {
          if (!storage.has(key)) {
            throw new StorageError({ message: `Key not found: ${key}` })
          }
          const value = storage.get(key)!
          if (value instanceof Uint8Array) {
            return model.deserialize<T>(value)
          } else {
            return value as T
          }
        })
      },

      setWithModel: (key: string, value: unknown, model: DataModel = defaultDataModel) => {
        return Effect.sync(() => {
          const serialized = model.serialize(value)
          storage.set(key, serialized)
          // Notify listeners
          const keyListeners = listeners.get(key) || []
          keyListeners.forEach((listener) => listener(serialized))
        })
      },

      getRaw: (key: string) => {
        return Effect.sync(() => {
          if (!storage.has(key)) {
            throw new StorageError({ message: `Key not found: ${key}` })
          }
          const value = storage.get(key)!
          if (value instanceof Uint8Array) {
            return value
          } else {
            // Convert to raw bytes using JSON serialization
            return new TextEncoder().encode(JSON.stringify(value))
          }
        })
      },

      setRaw: (key: string, data: Uint8Array) => {
        return Effect.sync(() => {
          storage.set(key, data)
          // Notify listeners
          const keyListeners = listeners.get(key) || []
          keyListeners.forEach((listener) => listener(data))
        })
      },

      query: (query: StorageQuery) => Effect.succeed([]) // Placeholder for memory storage
    }
  })
)
