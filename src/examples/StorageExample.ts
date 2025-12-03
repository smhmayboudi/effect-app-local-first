/**
 * Example demonstrating Storage System usage.
 */

import { Effect } from "effect"
import { JsonDataModel, MemoryStorageLive, StorageService } from "../Storage.js"

console.log("=== Storage System Example ===")

// Run the example using Effect
const program = Effect.gen(function*() {
  // Get the storage service
  const storage = yield* StorageService

  console.log("Setting values...")
  yield* storage.set("key1", "value1")
  yield* storage.set("key2", { name: "test", count: 42 })
  yield* storage.set("key3", [1, 2, 3, 4, 5])

  console.log("Getting values...")
  const value1 = yield* storage.get("key1")
  console.log("Value for key1:", value1)

  const value2 = yield* storage.get("key2")
  console.log("Value for key2:", value2)

  const value3 = yield* storage.get("key3")
  console.log("Value for key3:", value3)

  console.log("All keys:", yield* storage.keys())

  // Using data models
  const obj = { user: "john", preferences: { theme: "dark", lang: "en" } }
  const serialized = JsonDataModel.serialize(obj)
  console.log("Serialized object:", serialized)

  const deserialized = JsonDataModel.deserialize<typeof obj>(serialized)
  console.log("Deserialized object:", deserialized)

  // Test extended methods with models
  yield* storage.setWithModel("user-model", obj, JsonDataModel)
  const userFromModel = yield* storage.getWithModel<typeof obj>("user-model", JsonDataModel)
  console.log("User from model:", userFromModel)

  console.log("Testing raw bytes storage...")
  const rawBytes = new TextEncoder().encode("Hello, raw storage!")
  yield* storage.setRaw("raw-key", rawBytes)
  const retrievedRaw = yield* storage.getRaw("raw-key")
  console.log("Retrieved raw bytes:", new TextDecoder().decode(retrievedRaw))

  // Clean up
  yield* storage.clear()
  console.log("Cleared storage. Keys after clear:", yield* storage.keys())
})

// Run the program with the MemoryStorageLive layer
Effect.runPromise(program.pipe(Effect.provide(MemoryStorageLive)))
  .then(() => console.log("\n=== End Storage System Example ===\n"))
  .catch(console.error)
