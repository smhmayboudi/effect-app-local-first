import { Chunk, Context, Effect, Layer, Option as EffectOption, Stream } from "effect"
import { StorageError } from "./Errors.ts"

export interface StorageBackend {
  readonly get: (key: string) => Effect.Effect<unknown, StorageError>
  readonly set: (key: string, value: unknown) => Effect.Effect<void, StorageError>
  readonly delete: (key: string) => Effect.Effect<void, StorageError>
  readonly clear: () => Effect.Effect<void, StorageError>
  readonly keys: () => Effect.Effect<ReadonlyArray<string>, StorageError>
  readonly watch: (key: string) => Stream.Stream<unknown, StorageError>
}

export interface StorageService extends StorageBackend {}
export const StorageService = Context.GenericTag<StorageService>("StorageService")

// IndexedDB Implementation
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
        })
    }
  })
)

// Memory Storage for testing
export const MemoryStorageLive = Layer.effect(
  StorageService,
  Effect.sync(() => {
    const storage = new Map<string, unknown>()
    const listeners = new Map<string, Array<(value: unknown) => void>>()

    return {
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
        })
    }
  })
)
