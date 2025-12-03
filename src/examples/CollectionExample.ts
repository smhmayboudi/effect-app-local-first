/**
 * Example demonstrating Collection Framework usage.
 */

import { Effect, Layer } from "effect"
import {
  GSetCollection,
  LocalFirst,
  LocalFirstLive,
  LWWRegisterCollection,
  ORMapCollection,
  PNCounterCollection,
  RGACollection,
  TwoPhaseSetCollection
} from "../Framework.js"
import { MemoryStorageLive } from "../Storage.js"
import { ManualSyncLive } from "../Sync.js"

console.log("=== Collection Framework Example ===")

const program = Effect.gen(function*() {
  // Initialize LocalFirst context
  yield* LocalFirst

  console.log("Creating collections...")

  // Create different types of collections
  const registerCollection = new LWWRegisterCollection<string>("userProfile")
  const setCollection = new GSetCollection<string>("userTags")
  const mapCollection = new ORMapCollection<boolean>("userSettings")
  const counterCollection = new PNCounterCollection("userScore")
  const arrayCollection = new RGACollection<number>("userScores")
  const tpsetCollection = new TwoPhaseSetCollection<string>("userBlockList")

  console.log("Collection names:")
  console.log("- Register collection:", registerCollection.name)
  console.log("- Set collection:", setCollection.name)
  console.log("- Map collection:", mapCollection.name)
  console.log("- Counter collection:", counterCollection.name)
  console.log("- Array collection:", arrayCollection.name)
  console.log("- TwoPhaseSet collection:", tpsetCollection.name)

  // Use LWW Register Collection
  console.log("\n--- LWW Register Collection ---")
  yield* registerCollection.setValue("John Doe")
  const userValue = yield* registerCollection.getValue()
  console.log("User profile value:", userValue)

  // Use GSet Collection
  console.log("\n--- GSet Collection ---")
  yield* setCollection.add("developer")
  yield* setCollection.add("premium")
  yield* setCollection.add("active")
  const setValues = yield* setCollection.get()
  console.log("User tags:", setValues.values())

  // Use ORMap Collection
  console.log("\n--- ORMap Collection ---")
  yield* mapCollection.put("darkTheme", true)
  yield* mapCollection.put("notifications", false)
  yield* mapCollection.put("emailNotifications", true)
  const mapValues = yield* mapCollection.entries()
  console.log("User settings:", mapValues)

  // Use PNCounter Collection
  console.log("\n--- PNCounter Collection ---")
  yield* counterCollection.increment(10)
  yield* counterCollection.increment(5)
  yield* counterCollection.decrement(2)
  const counterValue = yield* counterCollection.get()
  console.log("User score:", counterValue.value())

  // Use RGA Collection
  console.log("\n--- RGA Collection ---")
  yield* arrayCollection.append(100)
  yield* arrayCollection.append(200)
  yield* arrayCollection.insertAt(1, 150)
  const arrayValues = yield* arrayCollection.get()
  console.log("User scores:", arrayValues.toArray())
  console.log("Array length:", arrayValues.length)

  // Use TwoPhaseSet Collection
  console.log("\n--- TwoPhaseSet Collection ---")
  yield* tpsetCollection.add("user123")
  yield* tpsetCollection.add("user456")
  yield* tpsetCollection.add("user789")
  const tpsetValues1 = yield* tpsetCollection.get()
  console.log("Blocked users before removal:", tpsetValues1.values())

  yield* tpsetCollection.remove("user456")
  const tpsetValues2 = yield* tpsetCollection.get()
  console.log("Blocked users after removal:", tpsetValues2.values())

  console.log("\nAll collections created and used successfully!")
})

// Run the program with memory implementations
const AppLive = Layer.mergeAll(
  LocalFirstLive({
    storage: "memory",
    sync: "manual",
    replicaId: "example-replica"
  }),
  MemoryStorageLive,
  ManualSyncLive
)

Effect.runPromise(program.pipe(Effect.provide(AppLive)))
  .then(() => console.log("\n=== End Collection Framework Example ===\n"))
  .catch(console.error)
