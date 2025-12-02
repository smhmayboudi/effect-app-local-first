import { Context, Effect, Layer, Queue, Schema, Stream } from "effect"
import type { VectorClock } from "./Core.js"
import { SyncError } from "./Errors.js"

/**
 * Represents a data conflict that occurs during synchronization.
 * This class is used when local and remote values differ during sync operations.
 */
class DataConflict extends Schema.TaggedClass<DataConflict>("@sync/DataConflict")("DataConflict", {
  key: Schema.String,
  localValue: Schema.Unknown,
  remoteValue: Schema.Unknown,
  timestamp: Schema.Number
}) {}

/**
 * Extended SyncOperation to support reconciliation.
 * Represents an operation to be synchronized between replicas.
 */
export interface SyncOperation {
  /** Unique identifier for this operation */
  readonly id: string
  /** Type of operation (set, delete, or reconcile) */
  readonly type: "set" | "delete" | "reconcile"
  /** Key of the data being operated on */
  readonly key: string
  /** Value to be stored (for set operations) */
  readonly value?: unknown
  /** Timestamp of the operation */
  readonly timestamp: number
  /** ID of the replica that originated this operation */
  readonly replicaId: string
  /** Vector clock associated with this operation */
  readonly vectorClock: VectorClock
  /** For reconciliation operations - the server's clock state */
  readonly serverClock?: VectorClock
  /** For reconciliation operations - the vector clock of the operation being reconciled */
  readonly operationVector?: VectorClock
  /** For partial sync - the collection name */
  readonly collection?: string
  /** For partial sync - tags for categorizing data */
  readonly tags?: Array<string>
  /** For partial sync - the scope/type of data */
  readonly scope?: string
}

/**
 * Server reconciliation request structure.
 * Contains information needed to reconcile differences between client and server state.
 */
export interface ReconciliationRequest {
  /** Unique identifier for this request */
  readonly id: string
  /** Array of operations from the client that may need reconciliation */
  readonly operations: Array<SyncOperation>
  /** Client's current vector clock state */
  readonly clientState: VectorClock
  /** ID of the replica making the request */
  readonly replicaId: string
  /** Timestamp of the request */
  readonly timestamp: number
}

/**
 * Server reconciliation response structure.
 * Contains the result of a reconciliation request from the server.
 */
export interface ReconciliationResponse {
  /** ID matching the original request */
  readonly id: string
  /** Status of the reconciliation */
  readonly status: "accepted" | "conflict" | "rejected"
  /** Operations to apply from the server */
  readonly serverOperations?: Array<SyncOperation>
  /** New resolved vector clock state after reconciliation */
  readonly resolvedState?: VectorClock
  /** Array of conflicts that need resolution */
  readonly conflicts?: Array<{
    key: string
    clientValue: unknown
    serverValue: unknown
    resolution: "client" | "server" | "merge"
  }>
}

/**
 * Partial sync configuration.
 * Allows for selective synchronization of specific data subsets.
 */
export interface PartialSyncConfig {
  /** Specific collections to sync */
  readonly collections?: Array<string>
  /** Tags to filter by */
  readonly tags?: Array<string>
  /** Specific scope to sync */
  readonly scope?: string
  /** Sync operations since a specific timestamp */
  readonly since?: number
  /** Maximum number of operations to sync */
  readonly limit?: number
}

/**
 * SyncEngine interface defining the core synchronization operations.
 * Provides methods for pushing, pulling, and reconciling data between replicas.
 */
export interface SyncEngine {
  /**
   * Pushes operations to other replicas or a central server.
   * @param operations - Array of operations to push
   * @returns Effect that completes when operations are pushed or a SyncError
   */
  readonly push: (operations: Array<SyncOperation>) => Effect.Effect<void, SyncError>
  /**
   * Pulls operations from other replicas or a central server.
   * @param config - Optional configuration for partial sync
   * @returns Effect that resolves to an array of operations or a SyncError
   */
  readonly pull: (config?: PartialSyncConfig) => Effect.Effect<Array<SyncOperation>, SyncError>
  /**
   * Initiates a reconciliation process with the server to resolve conflicts.
   * @param request - The reconciliation request with client state
   * @returns Effect that resolves to a reconciliation response or a SyncError
   */
  readonly reconcile: (request: ReconciliationRequest) => Effect.Effect<ReconciliationResponse, SyncError>
  /**
   * Performs a partial sync based on configuration.
   * @param config - Configuration for the partial sync
   * @returns Effect that completes when partial sync is finished or a SyncError
   */
  readonly partialSync: (config: PartialSyncConfig) => Effect.Effect<void, SyncError>
  /**
   * Stream of data conflicts that occur during synchronization.
   * @returns A Stream of DataConflict instances
   */
  readonly conflicts: Stream.Stream<DataConflict, SyncError>
  /**
   * Stream of sync status updates.
   * @returns A Stream of status values ("online", "offline", "syncing")
   */
  readonly status: Stream.Stream<"online" | "offline" | "syncing", never>
  /**
   * Establishes the sync connection.
   * @returns Effect that completes when connection is established or a SyncError
   */
  readonly connect: () => Effect.Effect<void, SyncError>
  /**
   * Closes the sync connection.
   * @returns Effect that completes when connection is closed
   */
  readonly disconnect: () => Effect.Effect<void, never>
}

/**
 * Sync service interface that extends the SyncEngine.
 */
export interface SyncService extends SyncEngine {}

/**
 * Context tag for the SyncService.
 */
export const SyncService = Context.GenericTag<SyncService>("SyncService")

/**
 * Layer providing WebSocket implementation of the SyncService.
 * This implementation uses WebSocket connections to synchronize data between replicas.
 * @param url - The WebSocket URL to connect to
 * @returns A Layer that provides a SyncService implementation
 */
export const WebSocketSyncLive = (url: string) =>
  Layer.effect(
    SyncService,
    Effect.gen(function*() {
      const operationQueue = yield* Queue.unbounded<SyncOperation>()
      const conflictQueue = yield* Queue.unbounded<DataConflict>()
      const statusQueue = yield* Queue.unbounded<"online" | "offline" | "syncing">()

      let ws: WebSocket | null = null
      let reconnectAttempts = 0
      const maxReconnectAttempts = 5

      const connect = (): Effect.Effect<void, SyncError> =>
        Effect.async<void, SyncError>((resume) => {
          try {
            ws = new WebSocket(url)

            ws.onopen = () => {
              reconnectAttempts = 0
              Queue.offer(statusQueue, "online").pipe(Effect.runPromise)
              resume(Effect.void)
            }

            ws.onerror = (error) => {
              resume(
                new SyncError({
                  message: "WebSocket connection failed",
                  code: "CONNECTION_ERROR",
                  cause: error
                })
              )
            }

            ws.onmessage = (event) => {
              const data = JSON.parse(event.data)
              if (data.type === "operations") {
                if (Array.isArray(data.operations)) {
                  data.operations.forEach((op: SyncOperation) => {
                    Queue.offer(operationQueue, op).pipe(
                      Effect.runPromise
                    )
                  })
                } else {
                  Queue.offer(operationQueue, data.operations).pipe(
                    Effect.runPromise
                  )
                }
              } else if (data.type === "conflict") {
                Queue.offer(conflictQueue, data.conflict).pipe(
                  Effect.runPromise
                )
              }
            }

            ws.onclose = () => {
              Queue.offer(statusQueue, "offline").pipe(Effect.runPromise)
              // Attempt reconnect
              if (reconnectAttempts < maxReconnectAttempts) {
                setTimeout(() => {
                  reconnectAttempts++
                  connect().pipe(Effect.runPromise)
                }, 1000 * reconnectAttempts)
              }
            }
          } catch (error) {
            resume(
              new SyncError({
                message: "Failed to create WebSocket",
                code: "INIT_ERROR",
                cause: error
              })
            )
          }
        })

      const disconnect = (): Effect.Effect<void, never> =>
        Effect.sync(() => {
          if (ws) {
            ws.close()
            ws = null
          }
        })

      const push = (operations: Array<SyncOperation>): Effect.Effect<void, SyncError> =>
        Effect.gen(function*() {
          if (!ws || ws.readyState !== WebSocket.OPEN) {
            return yield* new SyncError({
              message: "WebSocket not connected",
              code: "NOT_CONNECTED",
              cause: null
            })
          }

          yield* Queue.offer(statusQueue, "syncing")

          yield* Effect.async<void, SyncError>((resume) => {
            try {
              ws!.send(JSON.stringify({
                type: "push",
                operations,
                id: Math.random().toString(36).slice(2, 11)
              }))

              const timeout = setTimeout(() => {
                resume(
                  new SyncError({
                    message: "Push operation timeout",
                    code: "TIMEOUT",
                    cause: null
                  })
                )
              }, 10000)

              const messageHandler = (event: MessageEvent) => {
                const data = JSON.parse(event.data)
                if (data.type === "ack") {
                  clearTimeout(timeout)
                  ws!.removeEventListener("message", messageHandler)
                  Queue.offer(statusQueue, "online").pipe(Effect.runPromise)
                  resume(Effect.void)
                }
              }

              ws!.addEventListener("message", messageHandler)
            } catch (error) {
              resume(
                new SyncError({
                  message: "Failed to send operations",
                  code: "SEND_ERROR",
                  cause: error
                })
              )
            }
          })
        })

      const pull = (config?: PartialSyncConfig): Effect.Effect<Array<SyncOperation>, SyncError> =>
        Effect.gen(function*() {
          if (!ws || ws.readyState !== WebSocket.OPEN) {
            return yield* new SyncError({
              message: "WebSocket not connected",
              code: "NOT_CONNECTED",
              cause: null
            })
          }

          return yield* Effect.async<Array<SyncOperation>, SyncError>((resume) => {
            try {
              const requestId = Math.random().toString(36).slice(2, 11)
              ws!.send(JSON.stringify({
                type: "pull",
                id: requestId,
                config: config || {} // Send partial sync configuration
              }))

              const timeout = setTimeout(() => {
                resume(
                  new SyncError({
                    message: "Pull operation timeout",
                    code: "TIMEOUT",
                    cause: null
                  })
                )
              }, 10000)

              const messageHandler = (event: MessageEvent) => {
                const data = JSON.parse(event.data)
                if (data.type === "operations" && data.requestId === requestId) {
                  clearTimeout(timeout)
                  ws!.removeEventListener("message", messageHandler)
                  resume(Effect.succeed(data.operations))
                }
              }

              ws!.addEventListener("message", messageHandler)
            } catch (error) {
              resume(
                new SyncError({
                  message: "Failed to pull operations",
                  code: "PULL_ERROR",
                  cause: error
                })
              )
            }
          })
        })

      const reconcile = (request: ReconciliationRequest): Effect.Effect<ReconciliationResponse, SyncError> =>
        Effect.gen(function*() {
          if (!ws || ws.readyState !== WebSocket.OPEN) {
            return yield* new SyncError({
              message: "WebSocket not connected",
              code: "NOT_CONNECTED",
              cause: null
            })
          }

          yield* Queue.offer(statusQueue, "syncing")

          return yield* Effect.async<ReconciliationResponse, SyncError>((resume) => {
            try {
              ws!.send(JSON.stringify({
                type: "reconcile",
                ...request
              }))

              const timeout = setTimeout(() => {
                resume(
                  new SyncError({
                    message: "Reconciliation operation timeout",
                    code: "TIMEOUT",
                    cause: null
                  })
                )
              }, 15000) // Longer timeout for reconciliation

              const messageHandler = (event: MessageEvent) => {
                const data = JSON.parse(event.data)
                if (data.type === "reconcile-response" && data.id === request.id) {
                  clearTimeout(timeout)
                  ws!.removeEventListener("message", messageHandler)
                  Queue.offer(statusQueue, "online").pipe(Effect.runPromise)
                  resume(Effect.succeed(data.response))
                }
              }

              ws!.addEventListener("message", messageHandler)
            } catch (error) {
              resume(
                new SyncError({
                  message: "Failed to send reconciliation request",
                  code: "RECONCILE_ERROR",
                  cause: error
                })
              )
            }
          })
        })

      const partialSync = (config: PartialSyncConfig): Effect.Effect<void, SyncError> =>
        Effect.gen(function*() {
          if (!ws || ws.readyState !== WebSocket.OPEN) {
            return yield* new SyncError({
              message: "WebSocket not connected",
              code: "NOT_CONNECTED",
              cause: null
            })
          }

          yield* Queue.offer(statusQueue, "syncing")

          return yield* Effect.async<void, SyncError>((resume) => {
            try {
              ws!.send(JSON.stringify({
                type: "partial-sync",
                config
              }))

              const timeout = setTimeout(() => {
                resume(
                  new SyncError({
                    message: "Partial sync operation timeout",
                    code: "TIMEOUT",
                    cause: null
                  })
                )
              }, 10000)

              const messageHandler = (event: MessageEvent) => {
                const data = JSON.parse(event.data)
                if (data.type === "partial-sync-complete") {
                  clearTimeout(timeout)
                  ws!.removeEventListener("message", messageHandler)
                  Queue.offer(statusQueue, "online").pipe(Effect.runPromise)
                  resume(Effect.void)
                }
              }

              ws!.addEventListener("message", messageHandler)
            } catch (error) {
              resume(
                new SyncError({
                  message: "Failed to initiate partial sync",
                  code: "PARTIAL_SYNC_ERROR",
                  cause: error
                })
              )
            }
          })
        })

      // Start connection
      yield* connect()

      return {
        push,
        pull,
        reconcile,
        partialSync,
        conflicts: Stream.fromQueue(conflictQueue),
        status: Stream.fromQueue(statusQueue),
        connect,
        disconnect
      }
    })
  )

/**
 * Layer providing manual sync implementation of the SyncService.
 * This implementation performs no network operations and is primarily for offline-only scenarios.
 */
export const ManualSyncLive = Layer.succeed(
  SyncService,
  {
    /**
     * Pushes operations (no-op in manual sync).
     * @param operations - Operations to push (ignored in manual sync)
     * @returns Effect that completes immediately
     */
    push: () => Effect.void,
    /**
     * Pulls operations (returns empty array in manual sync).
     * @param config - Optional configuration (ignored in manual sync)
     * @returns Effect that resolves to an empty array of operations
     */
    pull: (config?: PartialSyncConfig) => Effect.succeed([]),
    /**
     * Reconciles operations (returns accepted status in manual sync).
     * @param request - Reconciliation request
     * @returns Effect that resolves to an accepted reconciliation response
     */
    reconcile: (request: ReconciliationRequest) =>
      Effect.succeed<ReconciliationResponse>({
        id: request.id,
        status: "accepted",
        resolvedState: request.clientState
      }),
    /**
     * Performs partial sync (no-op in manual sync).
     * @param config - Configuration for partial sync (ignored in manual sync)
     * @returns Effect that completes immediately
     */
    partialSync: (config: PartialSyncConfig) => Effect.void,
    /** Stream of conflicts (empty in manual sync) */
    conflicts: Stream.empty,
    /** Stream of status updates (always offline in manual sync) */
    status: Stream.succeed("offline" as const),
    /** Establishes connection (no-op in manual sync) */
    connect: () => Effect.void,
    /** Closes connection (no-op in manual sync) */
    disconnect: () => Effect.void
  }
)
