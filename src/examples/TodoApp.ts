import { Console, Effect, Layer, Stream } from "effect"
import { GSetCollection, LocalFirstLive, LWWRegisterCollection, ORMapCollection } from "../Framework.js"
import { MemoryStorageLive } from "../Storage.js"
import { ManualSyncLive } from "../Sync.js"

// Application configuration
const config = {
  storage: "indexeddb" as const,
  sync: "websocket" as const,
  syncUrl: "ws://localhost:8080/sync",
  replicaId: "client-" + Math.random().toString(36).substr(2, 9),
  autoSyncInterval: 5000
}

// Todo item schema
interface Todo {
  readonly id: string
  readonly text: string
  readonly completed: boolean
  readonly createdAt: number
}

// Todo application
const todoApp = Effect.gen(function*() {
  // Create collections
  const todos = new ORMapCollection<Todo>("todos")
  const userProfile = new LWWRegisterCollection<{ name: string; email: string }>("user:profile")
  const userTags = new GSetCollection<string>("user:tags")

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

  yield* Console.log("Current state:", { profile, tags, todos: currentTodos })

  return { todos, userProfile, userTags, watchFiber }
})

// Run the application
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

Effect.runPromise(main).catch((error) => {
  console.error("Failed to run application:", error)
})
