import { Context, Effect, Layer, Queue, Schema, Stream } from "effect"
import type { VectorClock } from "./Core.js"
import { SyncError } from "./Errors.js"

class DataConflict extends Schema.TaggedClass<DataConflict>("@sync/DataConflict")("DataConflict", {
  key: Schema.String,
  localValue: Schema.Unknown,
  remoteValue: Schema.Unknown,
  timestamp: Schema.Number
}) {}

// Extended SyncOperation to support reconciliation
export interface SyncOperation {
  readonly id: string
  readonly type: "set" | "delete" | "reconcile"
  readonly key: string
  readonly value?: unknown
  readonly timestamp: number
  readonly replicaId: string
  readonly vectorClock: VectorClock
  // For reconciliation operations
  readonly serverClock?: VectorClock
  readonly operationVector?: VectorClock // The vector clock of the operation being reconciled
}

// Server reconciliation request structure
export interface ReconciliationRequest {
  readonly id: string
  readonly operations: Array<SyncOperation>
  readonly clientState: VectorClock // Client's current vector clock state
  readonly replicaId: string
  readonly timestamp: number
}

// Server reconciliation response structure
export interface ReconciliationResponse {
  readonly id: string
  readonly status: "accepted" | "conflict" | "rejected"
  readonly serverOperations?: Array<SyncOperation> // Operations to apply from server
  readonly resolvedState?: VectorClock // New resolved vector clock state
  readonly conflicts?: Array<{
    key: string
    clientValue: unknown
    serverValue: unknown
    resolution: "client" | "server" | "merge"
  }>
}

export interface SyncEngine {
  readonly push: (operations: Array<SyncOperation>) => Effect.Effect<void, SyncError>
  readonly pull: () => Effect.Effect<Array<SyncOperation>, SyncError>
  readonly reconcile: (request: ReconciliationRequest) => Effect.Effect<ReconciliationResponse, SyncError>
  readonly conflicts: Stream.Stream<DataConflict, SyncError>
  readonly status: Stream.Stream<"online" | "offline" | "syncing", never>
  readonly connect: () => Effect.Effect<void, SyncError>
  readonly disconnect: () => Effect.Effect<void, never>
}

export interface SyncService extends SyncEngine {}
export const SyncService = Context.GenericTag<SyncService>("SyncService")

// WebSocket Sync Implementation
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
              resume(Effect.fail(
                new SyncError({
                  message: "WebSocket connection failed",
                  code: "CONNECTION_ERROR",
                  cause: error
                })
              ))
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
            resume(Effect.fail(
              new SyncError({
                message: "Failed to create WebSocket",
                code: "INIT_ERROR",
                cause: error
              })
            ))
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
            return yield* Effect.fail(
              new SyncError({
                message: "WebSocket not connected",
                code: "NOT_CONNECTED",
                cause: null
              })
            )
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
                resume(Effect.fail(
                  new SyncError({
                    message: "Push operation timeout",
                    code: "TIMEOUT",
                    cause: null
                  })
                ))
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
              resume(Effect.fail(
                new SyncError({
                  message: "Failed to send operations",
                  code: "SEND_ERROR",
                  cause: error
                })
              ))
            }
          })
        })

      const pull = (): Effect.Effect<Array<SyncOperation>, SyncError> =>
        Effect.gen(function*() {
          if (!ws || ws.readyState !== WebSocket.OPEN) {
            return yield* Effect.fail(
              new SyncError({
                message: "WebSocket not connected",
                code: "NOT_CONNECTED",
                cause: null
              })
            )
          }

          return yield* Effect.async<Array<SyncOperation>, SyncError>((resume) => {
            try {
              const requestId = Math.random().toString(36).slice(2, 11)
              ws!.send(JSON.stringify({ type: "pull", id: requestId }))

              const timeout = setTimeout(() => {
                resume(Effect.fail(
                  new SyncError({
                    message: "Pull operation timeout",
                    code: "TIMEOUT",
                    cause: null
                  })
                ))
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
              resume(Effect.fail(
                new SyncError({
                  message: "Failed to pull operations",
                  code: "PULL_ERROR",
                  cause: error
                })
              ))
            }
          })
        })

      const reconcile = (request: ReconciliationRequest): Effect.Effect<ReconciliationResponse, SyncError> =>
        Effect.gen(function*() {
          if (!ws || ws.readyState !== WebSocket.OPEN) {
            return yield* Effect.fail(
              new SyncError({
                message: "WebSocket not connected",
                code: "NOT_CONNECTED",
                cause: null
              })
            )
          }

          yield* Queue.offer(statusQueue, "syncing")

          return yield* Effect.async<ReconciliationResponse, SyncError>((resume) => {
            try {
              ws!.send(JSON.stringify({
                type: "reconcile",
                ...request
              }))

              const timeout = setTimeout(() => {
                resume(Effect.fail(
                  new SyncError({
                    message: "Reconciliation operation timeout",
                    code: "TIMEOUT",
                    cause: null
                  })
                ))
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
              resume(Effect.fail(
                new SyncError({
                  message: "Failed to send reconciliation request",
                  code: "RECONCILE_ERROR",
                  cause: error
                })
              ))
            }
          })
        })

      // Start connection
      yield* connect()

      return {
        push,
        pull,
        reconcile,
        conflicts: Stream.fromQueue(conflictQueue),
        status: Stream.fromQueue(statusQueue),
        connect,
        disconnect
      }
    })
  )

// Manual Sync for offline-only
export const ManualSyncLive = Layer.succeed(
  SyncService,
  {
    push: () => Effect.void,
    pull: () => Effect.succeed([]),
    reconcile: (request: ReconciliationRequest) =>
      Effect.succeed<ReconciliationResponse>({
        id: request.id,
        status: "accepted",
        resolvedState: request.clientState
      }),
    conflicts: Stream.empty,
    status: Stream.succeed("offline" as const),
    connect: () => Effect.void,
    disconnect: () => Effect.void
  }
)
