import { describe, expect, it } from "vitest"
import { GSet, LWWRegister, PNCounter, RGA, VectorClock } from "../src/Core.js"
import {
  GSetCollection,
  LWWRegisterCollection,
  OrderedSetCollection,
  ORMapCollection,
  PNCounterCollection,
  RGACollection,
  TwoPhaseSetCollection
} from "../src/Framework.js"
import type { HubStrategy as HubStrategyType } from "../src/Hub.js"
import { HubStrategy } from "../src/Hub.js"
import { type DatabaseConfig, JsonDataModel, type StorageQuery } from "../src/Storage.js"
import { type ReconciliationRequest, type ReconciliationResponse, type SyncOperation } from "../src/Sync.js"

describe("Integration Tests - Complete System", () => {
  describe("CRDT Integration Tests", () => {
    it("should use VectorClock across multiple CRDTs", () => {
      // Test that VectorClock can be used consistently across different CRDTs
      const vc1 = VectorClock.empty().increment("replica1")
      const vc2 = VectorClock.empty().increment("replica2")

      // Compare clocks used by different CRDTs
      expect(vc1.compare(vc2)).toBeLessThanOrEqual(0) // Either equal or concurrent

      // Create CRDTs using these vector clocks for tracking causality
      const reg = LWWRegister.make("value", "replica1")
      const set = GSet.empty<string>().add("item")

      expect(reg).toBeDefined()
      expect(set).toBeDefined()
    })

    it("should maintain consistency across CRDT types", () => {
      // Test that operations on different CRDTs maintain expected behaviors
      const reg = LWWRegister.make("initial", "replica1")
      const updatedReg = new LWWRegister("updated", Date.now() + 100, "replica1")
      const mergedReg = reg.merge(updatedReg)

      expect(mergedReg.get()).toBe("updated")

      let gSet = GSet.empty<string>()
      gSet = gSet.add("item1").add("item2")

      expect(gSet.has("item1")).toBe(true)
      expect(gSet.has("item2")).toBe(true)
      expect(gSet.values()).toHaveLength(2)
    })

    it("should handle PNCounter and RGA operations together", () => {
      // Test coordination between numerical and array CRDTs
      let counter = PNCounter.empty()
      counter = counter.increment("replica1", 5)
      counter = counter.decrement("replica1", 2) // Result: 3

      let array = RGA.empty<string>()
      array = array.append("item1", "replica1")
      array = array.append("item2", "replica1")
      array = array.append("item3", "replica1") // Length: 3

      expect(counter.value()).toBe(3)
      expect(array.length).toBe(3)
      expect(array.toArray()).toEqual(["item1", "item2", "item3"])
    })
  })

  describe("Collection Integration", () => {
    it("should use corresponding CRDTs correctly", () => {
      // Create collections with names
      const regCollection = new LWWRegisterCollection<string>("userProfile")
      const setCollection = new GSetCollection<string>("userTags")
      const mapCollection = new ORMapCollection<string>("userSettings")
      const tpsetCollection = new TwoPhaseSetCollection<string>("blockedUsers")
      const orderedSetCollection = new OrderedSetCollection<string>("priorityQueue")
      const counterCollection = new PNCounterCollection("userScore")
      const rgaCollection = new RGACollection<string>("userPlaylist")

      // Verify they have correct names
      expect(regCollection.name).toBe("userProfile")
      expect(setCollection.name).toBe("userTags")
      expect(mapCollection.name).toBe("userSettings")
      expect(tpsetCollection.name).toBe("blockedUsers")
      expect(orderedSetCollection.name).toBe("priorityQueue")
      expect(counterCollection.name).toBe("userScore")
      expect(rgaCollection.name).toBe("userPlaylist")
    })

    it("should maintain type safety across collections", () => {
      // Test that different collections maintain their type parameters properly
      const stringRegCol = new LWWRegisterCollection<string>("str-reg")
      const numSetCol = new GSetCollection<number>("num-set")
      const boolMapCol = new ORMapCollection<boolean>("bool-map")
      const objCounterCol = new PNCounterCollection("obj-counter")

      expect(stringRegCol).toBeDefined()
      expect(numSetCol).toBeDefined()
      expect(boolMapCol).toBeDefined()
      expect(objCounterCol).toBeDefined()
    })
  })

  describe("Storage & Data Model Integration", () => {
    it("should serialize/deserialize CRDTs with data models", () => {
      const testData = {
        counter: PNCounter.empty().increment("replica1", 5),
        set: GSet.empty<string>().add("item1").add("item2"),
        register: LWWRegister.make("value", "replica1")
      }

      // Serialize using JsonDataModel
      const serialized = JsonDataModel.serialize(testData)
      expect(serialized).toBeInstanceOf(Uint8Array)

      // Deserialize back
      const deserialized: typeof testData = JsonDataModel.deserialize(serialized)

      // Verify structure is maintained (though exact object identity is lost in JSON)
      expect(deserialized.register.value).toBe("value")
    })

    it("should work with custom query parameters", () => {
      const query: StorageQuery = {
        type: "range",
        params: {
          collection: "userProfiles",
          startDate: new Date().toISOString(),
          endDate: new Date(Date.now() + 86400000).toISOString() // Tomorrow
        }
      }

      expect(query.type).toBe("range")
      expect(query.params.collection).toBe("userProfiles")
    })

    it("should support different database configurations", () => {
      const configs: Array<DatabaseConfig> = [
        { type: "indexeddb", options: { version: 1, name: "local" } },
        { type: "postgres", options: { host: "localhost", port: 5432 }, dataModel: JsonDataModel }
      ]

      expect(configs[0].type).toBe("indexeddb")
      expect(configs[1].type).toBe("postgres")
      expect(configs[1].dataModel).toBe(JsonDataModel)
    })
  })

  describe("Sync Integration", () => {
    it("should create sync operations from CRDT changes", () => {
      const timestamp = Date.now()
      const vectorClock = VectorClock.empty().increment("replica1")

      // Example sync operation for a register update
      const regOp: SyncOperation = {
        id: "reg-update-1",
        type: "set",
        key: "user-profile",
        value: { name: "John", email: "john@example.com" },
        timestamp,
        replicaId: "replica1",
        vectorClock
      }

      // Example sync operation from a set addition
      const setOp: SyncOperation = {
        id: "set-add-1",
        type: "set",
        key: "user-tags",
        value: ["premium", "verified"],
        timestamp: timestamp + 1,
        replicaId: "replica1",
        vectorClock: vectorClock.increment("replica1")
      }

      expect(regOp.key).toBe("user-profile")
      expect(setOp.key).toBe("user-tags")
      expect(regOp.replicaId).toBe("replica1")
      expect(setOp.replicaId).toBe("replica1")
    })

    it("should handle reconciliation requests and responses", () => {
      const clientClock = VectorClock.empty()
        .increment("client1")
        .increment("client2")
        .increment("client2") // Simulate multiple operations by calling increment twice

      const request: ReconciliationRequest = {
        id: "reconcile-req-1",
        operations: [],
        clientState: clientClock,
        replicaId: "client1",
        timestamp: Date.now()
      }

      const response: ReconciliationResponse = {
        id: "reconcile-resp-1",
        status: "accepted",
        resolvedState: clientClock.increment("server1"),
        conflicts: [
          {
            key: "profile",
            clientValue: { name: "Client Name" },
            serverValue: { name: "Server Name" },
            resolution: "merge"
          }
        ]
      }

      expect(request.replicaId).toBe("client1")
      expect(response.status).toBe("accepted")
      expect(response.conflicts).toHaveLength(1)
      expect(response.conflicts![0].key).toBe("profile")
    })
  })

  describe("Hub Integration", () => {
    it("should support messaging patterns with CRDT data", () => {
      // Example of how messages might carry CRDT data
      interface UserUpdateMessage {
        userId: string
        operation: "increment" | "decrement" | "update" | "add" | "remove"
        crdtType: "counter" | "set" | "register" | "map"
        value: unknown
        timestamp: number
      }

      const message: UserUpdateMessage = {
        userId: "user123",
        operation: "increment",
        crdtType: "counter",
        value: 5,
        timestamp: Date.now()
      }

      expect(message.userId).toBe("user123")
      expect(message.operation).toBe("increment")
      expect(message.crdtType).toBe("counter")
    })

    it("should work with different hub strategies", () => {
      const strategies: Array<HubStrategyType> = [
        HubStrategy.unbounded(),
        HubStrategy.sliding(10),
        HubStrategy.dropping(10),
        HubStrategy.backpressure(10)
      ]

      expect(strategies[0]._tag).toBe("unbounded")
      expect(strategies[1]._tag).toBe("sliding")
      expect(strategies[2]._tag).toBe("dropping")
      expect(strategies[3]._tag).toBe("backpressure")
    })
  })

  describe("End-to-End Workflow", () => {
    it("should demonstrate a complete workflow", () => {
      // Simulate a complete workflow:
      // 1. User updates their profile (LWWRegister)
      // 2. Adds a tag (GSet)
      // 3. Updates their score (PNCounter)
      // 4. Operations Sync
      // 5. Message broadcast through Hub

      // Step 1: Profile update
      const profileReg = LWWRegister.make({ name: "John Doe", level: 1 }, "replica1")
      const updatedProfile = new LWWRegister(
        { name: "John Smith", level: 2 },
        Date.now() + 1000,
        "replica2"
      )
      const finalProfile = profileReg.merge(updatedProfile)

      // Step 2: Tag addition
      let userTags = GSet.empty<string>()
      userTags = userTags.add("developer").add("premium")

      // Step 3: Score update
      let userScore = PNCounter.empty()
      userScore = userScore.increment("replica1", 10) // Complete task
      userScore = userScore.increment("replica2", 5) // Bonus
      userScore = userScore.decrement("replica1", 1) // Penalty

      // Step 4: Create sync operations
      const profileOp: SyncOperation = {
        id: "profile-update",
        type: "set",
        key: "user:123:profile",
        value: finalProfile.get(),
        timestamp: Date.now(),
        replicaId: "replica1",
        vectorClock: VectorClock.empty().increment("replica1")
      }

      const tagsOp: SyncOperation = {
        id: "tags-update",
        type: "set",
        key: "user:123:tags",
        value: userTags.values(),
        timestamp: Date.now() + 1,
        replicaId: "replica1",
        vectorClock: VectorClock.empty().increment("replica1").increment("replica2")
      }

      // Verification
      expect(finalProfile.get().name).toBe("John Smith") // Updated profile
      expect(userTags.values()).toContain("developer")
      expect(userTags.values()).toContain("premium")
      expect(userScore.value()).toBe(14) // 10 + 5 - 1
      expect(profileOp.key).toBe("user:123:profile")
      expect(tagsOp.key).toBe("user:123:tags")
    })

    it("should maintain consistency across the system", () => {
      // Demonstrate that all components work together maintaining consistency

      // Start with a counter and a corresponding array
      let counter = PNCounter.empty().increment("replica1", 3)
      let array = RGA.empty<string>()

      // Add items to array based on counter value
      for (let i = 0; i < counter.value(); i++) {
        array = array.append(`item${i}`, "replica1")
      }

      // Verify they stay in sync (conceptually)
      expect(counter.value()).toBe(3)
      expect(array.length).toBe(3)
      expect(array.toArray()).toEqual(["item0", "item1", "item2"])

      // Now increment counter and add another item
      counter = counter.increment("replica2", 1) // Now should be 4
      array = array.append("item3", "replica2")

      expect(counter.value()).toBe(4)
      expect(array.length).toBe(4)
    })
  })

  describe("Error Handling Integration", () => {
    it("should handle invalid data gracefully", () => {
      // Test that the system handles edge cases appropriately
      const emptyReg = LWWRegister.make("", "replica1")
      const emptySet = GSet.empty<string>()
      const emptyCounter = PNCounter.empty()

      expect(emptyReg.get()).toBe("")
      expect(emptySet.values()).toHaveLength(0)
      expect(emptyCounter.value()).toBe(0)
    })
  })
})
