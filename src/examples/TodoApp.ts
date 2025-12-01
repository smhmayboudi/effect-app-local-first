/**
 * Example Todo application demonstrating the LocalFirst framework.
 * This application showcases various CRDT collections and their usage in a practical todo app scenario.
 */

import { Console, Effect, Layer, Stream } from "effect"
import {
  GSetCollection,
  LocalFirstLive,
  LWWRegisterCollection,
  ORMapCollection,
  PNCounterCollection,
  RGACollection,
  TwoPhaseSetCollection
} from "../Framework.js"
import { MemoryStorageLive } from "../Storage.js"
import { ManualSyncLive } from "../Sync.js"

/**
 * Application configuration for the Todo app.
 */
const config = {
  /** Storage backend to use */
  storage: "indexeddb" as const,
  /** Sync strategy to use */
  sync: "websocket" as const,
  /** URL for WebSocket synchronization */
  syncUrl: "ws://localhost:8080/sync",
  /** Unique identifier for this replica in the distributed system */
  replicaId: "client-" + Math.random().toString(36).substr(2, 9),
  /** Interval in milliseconds for automatic synchronization */
  autoSyncInterval: 5000
}

/**
 * Interface representing a todo item with its properties.
 */
interface Todo {
  /** Unique identifier for the todo item */
  readonly id: string
  /** Text content of the todo */
  readonly text: string
  /** Whether the todo is completed */
  readonly completed: boolean
  /** Timestamp of when the todo was created */
  readonly createdAt: number
}

/**
 * The main todo application effect that demonstrates:
 * - Using various CRDT collections (ORMap, LWWRegister, GSet, PNCounter, RGA, TwoPhaseSet)
 * - Initializing data in different collections
 * - Performing operations on the collections
 * - Watching for changes in the collections
 */
const todoApp = Effect.gen(function*() {
  // Create collections
  const todos = new ORMapCollection<Todo>("todos")
  const userProfile = new LWWRegisterCollection<{ name: string; email: string }>("user:profile")
  const userTags = new GSetCollection<string>("user:tags")

  // New CRDT collections
  const userActivityCounter = new PNCounterCollection("user:activity-count")
  const todoListHistory = new RGACollection<string>("todo:history") // Track changes to todo list
  const completedTodoIds = new TwoPhaseSetCollection<string>("todo:completed-ids") // Track completed todo IDs

  // Initialize user profile
  yield* userProfile.setValue({
    name: "John Doe",
    email: "john@example.com"
  })

  // Add some tags
  yield* userTags.add("premium")
  yield* userTags.add("verified")

  // Add todos
  yield* todos.put("1", {
    id: "1",
    text: "Learn Effect-TS",
    completed: false,
    createdAt: Date.now()
  })

  yield* todos.put("2", {
    id: "2",
    text: "Build local-first app",
    completed: true,
    createdAt: Date.now()
  })

  // Use the new CRDTs
  // Increment activity counter
  yield* userActivityCounter.increment(5)
  yield* userActivityCounter.increment(2) // Total should be 7

  // Add some todo history to the RGA
  yield* todoListHistory.append("Added Learn Effect-TS task")
  yield* todoListHistory.append("Added Build local-first app task")
  yield* todoListHistory.insertAt(1, "Marked first task as completed") // Insert in middle

  // Track completed todos in the TwoPhaseSet
  yield* completedTodoIds.add("1") // Mark todo "1" as completed
  yield* completedTodoIds.add("2") // Mark todo "2" as completed

  // Watch for changes - fork as a background task
  const watchFiber = yield* Effect.fork(
    todos.watch().pipe(
      Stream.runForEach((updatedTodos: any) => Effect.sync(() => Console.log(`Todos updated:`, updatedTodos.entries())))
    )
  )

  // Get current state
  const currentTodos = yield* todos.entries()
  const profile = yield* userProfile.getValue()
  const tags = yield* userTags.values()
  const activityCount = yield* userActivityCounter.value()
  const history = yield* todoListHistory.toArray()
  const completedTodos = yield* completedTodoIds.values()

  yield* Console.log("Current state:", {
    profile,
    tags,
    todos: currentTodos,
    activityCount,
    history,
    completedTodos
  })

  return { todos, userProfile, userTags, userActivityCounter, todoListHistory, completedTodoIds, watchFiber }
})

/**
 * The main application effect with proper layer configuration.
 */
const main = todoApp.pipe(
  Effect.provide(
    Layer.mergeAll(
      LocalFirstLive(config),
      ManualSyncLive,
      MemoryStorageLive
    )
  ),
  Effect.catchAll((error) => Console.error("Application failed:", error))
)

// Run the application
Effect.runPromise(main).catch((error) => {
  console.error("Failed to run application:", error)
})
