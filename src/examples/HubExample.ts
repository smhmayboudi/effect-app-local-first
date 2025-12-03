/**
 * Example demonstrating Hub (Pub/Sub) System usage.
 */

import { Effect, pipe, Stream } from "effect"
import { unbounded } from "../Hub.js"

console.log("=== Hub System Example ===")

const program = Effect.gen(function*() {
  // Create a hub
  const hub = yield* unbounded<string>()

  // Subscribe to messages
  const subscriber1 = hub.subscribe()
  const subscriber2 = hub.subscribe()

  // Send some messages
  console.log("Publishing messages...")
  yield* hub.publish("Hello from publisher!")
  yield* hub.publish("This is a second message")
  yield* hub.publish("Third message for all subscribers")

  // Read messages from subscriber 1
  console.log("\n--- Subscriber 1 messages ---")
  yield* pipe(
    subscriber1,
    Stream.take(3),
    Stream.runForEach((message) => Effect.sync(() => console.log("Subscriber 1 received:", message)))
  )

  // Send more messages
  yield* hub.publish("Message after first batch")
  yield* hub.publish("Another message")

  // Read messages from subscriber 2 (should get messages sent after subscription)
  console.log("\n--- Subscriber 2 messages ---")
  yield* pipe(
    subscriber2,
    Stream.take(2),
    Stream.runForEach((message) => Effect.sync(() => console.log("Subscriber 2 received:", message)))
  )
})

// Run the program
Effect.runPromise(program)
  .then(() => console.log("\n=== End Hub System Example ===\n"))
  .catch(console.error)
