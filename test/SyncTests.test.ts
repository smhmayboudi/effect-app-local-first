import { describe, expect, it } from "vitest"
import { VectorClock } from "../src/Core.js"
import { type ReconciliationRequest, type ReconciliationResponse, type SyncOperation } from "../src/Sync.js"

describe("Sync Operations Tests", () => {
  describe("SyncOperation Interface", () => {
    it("should define correct operation types", () => {
      const operation: SyncOperation = {
        id: "test-op",
        type: "set", // "set" | "delete" | "reconcile"
        key: "test-key",
        value: "test-value",
        timestamp: Date.now(),
        replicaId: "replica1",
        vectorClock: VectorClock.empty(),
        serverClock: VectorClock.empty(), // For reconciliation operations
        operationVector: VectorClock.empty(), // The vector clock of the operation being reconciled
        // For partial sync
        collection: "collection1",
        tags: ["tag1", "tag2"],
        scope: "user-data"
      }

      expect(operation.id).toBe("test-op")
      expect(operation.type).toBe("set")
      expect(operation.key).toBe("test-key")
      expect(operation.value).toBe("test-value")
      expect(typeof operation.timestamp).toBe("number")
      expect(operation.replicaId).toBe("replica1")
      expect(operation.collection).toBe("collection1")
      expect(operation.tags).toEqual(["tag1", "tag2"])
      expect(operation.scope).toBe("user-data")
    })

    it("should support all operation types", () => {
      const setOp: SyncOperation = {
        id: "set-op",
        type: "set",
        key: "key1",
        value: "value1",
        timestamp: Date.now(),
        replicaId: "replica1",
        vectorClock: VectorClock.empty()
      }

      const deleteOp: SyncOperation = {
        id: "delete-op",
        type: "delete",
        key: "key1",
        timestamp: Date.now(),
        replicaId: "replica1",
        vectorClock: VectorClock.empty()
      }

      const reconcileOp: SyncOperation = {
        id: "reconcile-op",
        type: "reconcile",
        key: "key1",
        timestamp: Date.now(),
        replicaId: "replica1",
        vectorClock: VectorClock.empty()
      }

      expect(setOp.type).toBe("set")
      expect(deleteOp.type).toBe("delete")
      expect(reconcileOp.type).toBe("reconcile")
    })
  })

  describe("Reconciliation Structures", () => {
    it("should define ReconciliationRequest correctly", () => {
      const request: ReconciliationRequest = {
        id: "req-123",
        operations: [],
        clientState: VectorClock.empty(),
        replicaId: "client1",
        timestamp: Date.now()
      }

      expect(request.id).toBe("req-123")
      expect(request.operations).toEqual([])
      expect(request.replicaId).toBe("client1")
      expect(typeof request.timestamp).toBe("number")
    })

    it("should define ReconciliationResponse correctly", () => {
      const response: ReconciliationResponse = {
        id: "resp-123",
        status: "accepted",
        serverOperations: [],
        resolvedState: VectorClock.empty(),
        conflicts: [
          {
            key: "conflict-key",
            clientValue: "client-value",
            serverValue: "server-value",
            resolution: "client"
          }
        ]
      }

      expect(response.id).toBe("resp-123")
      expect(response.status).toBe("accepted")
      expect(response.serverOperations).toEqual([])
      expect(response.conflicts).toBeDefined()
      expect(response.conflicts![0].key).toBe("conflict-key")
      expect(response.conflicts![0].resolution).toBe("client")
    })

    it("should support different reconciliation statuses", () => {
      const acceptedResp: ReconciliationResponse = {
        id: "resp-1",
        status: "accepted",
        resolvedState: VectorClock.empty()
      }

      const conflictResp: ReconciliationResponse = {
        id: "resp-2",
        status: "conflict",
        resolvedState: VectorClock.empty()
      }

      const rejectedResp: ReconciliationResponse = {
        id: "resp-3",
        status: "rejected",
        resolvedState: VectorClock.empty()
      }

      expect(acceptedResp.status).toBe("accepted")
      expect(conflictResp.status).toBe("conflict")
      expect(rejectedResp.status).toBe("rejected")
    })

    it("should support different conflict resolutions", () => {
      const clientResolutionResp: ReconciliationResponse = {
        id: "resp-1",
        status: "conflict",
        conflicts: [{
          key: "key1",
          clientValue: "client",
          serverValue: "server",
          resolution: "client"
        }]
      }

      const serverResolutionResp: ReconciliationResponse = {
        id: "resp-2",
        status: "conflict",
        conflicts: [{
          key: "key1",
          clientValue: "client",
          serverValue: "server",
          resolution: "server"
        }]
      }

      const mergeResolutionResp: ReconciliationResponse = {
        id: "resp-3",
        status: "conflict",
        conflicts: [{
          key: "key1",
          clientValue: "client",
          serverValue: "server",
          resolution: "merge"
        }]
      }

      expect(clientResolutionResp.conflicts![0].resolution).toBe("client")
      expect(serverResolutionResp.conflicts![0].resolution).toBe("server")
      expect(mergeResolutionResp.conflicts![0].resolution).toBe("merge")
    })
  })

  describe("VectorClock in Sync Operations", () => {
    it("should use VectorClock correctly in operations", () => {
      const clock = VectorClock.empty().increment("replica1").increment("replica2")

      const operation: SyncOperation = {
        id: "clock-test",
        type: "set",
        key: "test",
        value: "value",
        timestamp: Date.now(),
        replicaId: "replica1",
        vectorClock: clock
      }

      expect(operation.vectorClock.timestamps.replica1).toBe(1)
      expect(operation.vectorClock.timestamps.replica2).toBe(1)
    })

    it("should handle client and server clocks in reconciliation", () => {
      const clientClock = VectorClock.empty().increment("client1")
      const serverClock = VectorClock.empty().increment("server1")

      const request: ReconciliationRequest = {
        id: "reconcile-request",
        operations: [],
        clientState: clientClock,
        replicaId: "client1",
        timestamp: Date.now()
      }

      const response: ReconciliationResponse = {
        id: "reconcile-response",
        status: "accepted",
        resolvedState: serverClock
      }

      expect(request.clientState.timestamps.client1).toBe(1)
      expect(response.resolvedState?.timestamps.server1).toBe(1)
    })
  })

  describe("Partial Sync Features", () => {
    it("should support collection-based filtering", () => {
      const operation: SyncOperation = {
        id: "partial-op",
        type: "set",
        key: "item1",
        value: "data",
        timestamp: Date.now(),
        replicaId: "replica1",
        vectorClock: VectorClock.empty(),
        collection: "userProfile"
      }

      expect(operation.collection).toBe("userProfile")
    })

    it("should support tag-based filtering", () => {
      const operation: SyncOperation = {
        id: "tagged-op",
        type: "set",
        key: "pref1",
        value: "setting",
        timestamp: Date.now(),
        replicaId: "replica1",
        vectorClock: VectorClock.empty(),
        tags: ["important", "priority"]
      }

      expect(operation.tags).toEqual(expect.arrayContaining(["important", "priority"]))
    })

    it("should support scope-based filtering", () => {
      const operation: SyncOperation = {
        id: "scoped-op",
        type: "set",
        key: "doc1",
        value: "content",
        timestamp: Date.now(),
        replicaId: "replica1",
        vectorClock: VectorClock.empty(),
        scope: "document"
      }

      expect(operation.scope).toBe("document")
    })
  })
})
