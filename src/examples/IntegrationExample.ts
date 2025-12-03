/**
 * Comprehensive example demonstrating integration of multiple systems.
 * This example shows how VectorClocks, CRDTs, Storage, Sync, and Collections work together.
 */

import { Effect, Layer } from "effect"
import { GSet, LWWRegister, PNCounter, VectorClock } from "../Core.js"
import { GSetCollection, LocalFirstLive, LWWRegisterCollection, PNCounterCollection } from "../Framework.js"
import { JsonDataModel, MemoryStorageLive, StorageService } from "../Storage.js"
import { ManualSyncLive, type SyncOperation, SyncService } from "../Sync.js"

console.log("=== Comprehensive Integration Example ===")

const program = Effect.gen(function*() {
  console.log("\n--- Step 1: Core CRDT Operations ---")

  // Create and use core CRDTs
  const reg1 = LWWRegister.make("initial-value", "replica1")
  const reg2 = new LWWRegister("newer-value", Date.now() + 1000, "replica2")
  const mergedReg = reg1.merge(reg2)

  console.log("Merged register value:", mergedReg.value)

  let gset = GSet.empty<string>()
  gset = gset.add("item1").add("item2").add("item3")
  console.log("GSet values:", gset.values())

  let counter = PNCounter.empty()
  counter = counter.increment("replica1", 5).decrement("replica2", 2)
  console.log("Counter value:", counter.value())

  console.log("\n--- Step 2: Vector Clock for Causality ---")

  const clock1 = VectorClock.empty().increment("replica1")
  const clock2 = clock1.increment("replica2") // Replica 2 received from Replica 1
  console.log("Clock 1:", clock1.timestamps)
  console.log("Clock 2:", clock2.timestamps)
  console.log("Clock comparison (1 vs 2):", clock1.compare(clock2))

  console.log("\n--- Step 3: Storage Operations ---")

  const storage = yield* StorageService

  // Store CRDT state
  yield* storage.set("register-state", mergedReg)
  yield* storage.set("set-state", gset)
  yield* storage.set("counter-state", counter)

  // Retrieve and verify
  const storedReg = yield* storage.get("register-state")
  if (storedReg && typeof storedReg === "object" && "value" in storedReg) {
    console.log("Retrieved register from storage:", (storedReg as any).value)
  } else {
    console.log("Retrieved register from storage: not a register object")
  }

  console.log("\n--- Step 4: Sync Operations ---")

  const sync = yield* SyncService

  // Create sync operations from local changes
  const syncOp: SyncOperation = {
    id: "sync-op-1",
    type: "set",
    key: "register-state",
    value: mergedReg,
    timestamp: Date.now(),
    replicaId: "replica1",
    vectorClock: clock2
  }

  yield* sync.push([syncOp]) // Sync push expects an array of operations
  console.log("Pushed sync operation:", syncOp.id)

  console.log("\n--- Step 5: Framework Collections ---")

  // Create collections that integrate all the systems
  const profileCollection = new LWWRegisterCollection<{ name: string; active: boolean }>("user-profile")
  const tagCollection = new GSetCollection<string>("user-tags")
  const scoreCollection = new PNCounterCollection("user-score")

  // Use collections (they integrate storage and sync automatically)
  yield* profileCollection.setValue({ name: "Alice", active: true })
  yield* tagCollection.add("developer")
  yield* tagCollection.add("tester")
  yield* scoreCollection.increment(10)

  const profile = yield* profileCollection.getValue()
  const tags = yield* tagCollection.values()
  const score = yield* scoreCollection.value()

  console.log("Profile:", profile)
  console.log("Tags:", tags)
  console.log("Score:", score)

  console.log("\n--- Step 6: Serialization with Data Models ---")

  const complexData = {
    profile,
    tags: Array.from(tags),
    score,
    timestamp: Date.now()
  }

  const serialized = JsonDataModel.serialize(complexData)
  console.log("Serialized complex data length:", serialized.length)

  const deserialized = JsonDataModel.deserialize<typeof complexData>(serialized)
  console.log("Deserialized data:", deserialized)

  console.log("\n--- Step 7: Demonstrate Convergence ---")

  // Simulate how different replicas would converge
  const replica1State = {
    register: LWWRegister.make("value-from-replica1", "replica1"),
    set: GSet.empty<string>().add("replica1-item"),
    counter: PNCounter.empty().increment("replica1", 5)
  }

  const replica2State = {
    register: new LWWRegister("value-from-replica2", Date.now() + 1000, "replica2"), // Later timestamp
    set: GSet.empty<string>().add("replica2-item"),
    counter: PNCounter.empty().increment("replica2", 3)
  }

  // Simulate merging states (this is what happens during sync)
  const convergedState = {
    register: replica1State.register.merge(replica2State.register),
    set: replica1State.set.merge(replica2State.set),
    counter: replica1State.counter.merge(replica2State.counter)
  }

  console.log("Converged register value:", convergedState.register.value)
  console.log("Converged set values:", convergedState.set.values())
  console.log("Converged counter value:", convergedState.counter.value())

  console.log("\nAll systems integrated successfully!")
})

// Create combined layer
const CombinedLive = Layer.mergeAll(
  LocalFirstLive({
    storage: "memory",
    sync: "manual",
    replicaId: "integration-example"
  }),
  MemoryStorageLive,
  ManualSyncLive
)

// Run the program
Effect.runPromise(program.pipe(Effect.provide(CombinedLive)))
  .then(() => console.log("\n=== End Comprehensive Integration Example ===\n"))
  .catch(console.error)
