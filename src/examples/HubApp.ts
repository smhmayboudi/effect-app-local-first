/**
 * Example application demonstrating Hub usage in the LocalFirst framework.
 * This application shows how to create and use a message hub for event publishing and subscribing.
 */

import { Effect, Layer, Stream } from "effect"
import { Collection, LocalFirstLive } from "../Framework.js"
import { HubServiceLive } from "../Hub.js"

/**
 * Interface representing a user event with type, user ID, and timestamp.
 */
interface UserEvent {
  /** The type of event: user created, updated, or deleted */
  readonly type: "userCreated" | "userUpdated" | "userDeleted"
  /** The ID of the user associated with the event */
  readonly userId: string
  /** The timestamp of the event */
  readonly timestamp: number
}

/**
 * The main hub application effect that demonstrates:
 * - Creating a hub through the LocalFirst framework
 * - Subscribing to events
 * - Publishing single and multiple events
 * - Getting hub statistics
 */
const hubApp = Effect.gen(function*() {
  // Create a hub for user events through the LocalFirst framework
  const userEventHub = yield* new Collection<unknown>("users").createHub<UserEvent>()

  // Subscribe to events
  const subscription = userEventHub.subscribe()

  // Handle events directly without forking to avoid context issues
  yield* Stream.runForEach(subscription, (event) =>
    Effect.sync(() => {
      console.log(`Received event: ${event.type} for user ${event.userId}`)
    }))

  // Publish some events
  yield* userEventHub.publish({
    type: "userCreated",
    userId: "123",
    timestamp: Date.now()
  })

  yield* userEventHub.publish({
    type: "userUpdated",
    userId: "123",
    timestamp: Date.now()
  })

  // Publish multiple events
  yield* userEventHub.publishAll([
    {
      type: "userCreated",
      userId: "456",
      timestamp: Date.now()
    },
    {
      type: "userCreated",
      userId: "789",
      timestamp: Date.now()
    }
  ])

  // Show hub stats
  const subscriberCount = yield* userEventHub.subscriberCount()
  const size = yield* userEventHub.size()

  console.log(`Subscribers: ${subscriberCount}, Size: ${size}`)
}).pipe(
  Effect.provide(
    Layer.mergeAll(
      LocalFirstLive({
        storage: "memory",
        sync: "manual",
        replicaId: "example-client"
      }),
      HubServiceLive
    )
  )
)

// Run the example
Effect.runPromise(hubApp).then(
  () => console.log("Example completed"),
  (error) => console.error("Example failed:", error)
)
