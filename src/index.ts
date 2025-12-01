
/**
 * Main entry point for the LocalFirst library.
 * This file exports all the major modules of the LocalFirst framework.
 */

/**
 * Core Conflict-free Replicated Data Types (CRDTs) and distributed systems primitives.
 */
export * as Core from "./Core.js"

/**
 * Error types used throughout the LocalFirst framework.
 */
export * as Errors from "./Errors.js"

/**
 * The main LocalFirst framework that provides distributed data structures and synchronization.
 */
export * as Framework from "./Framework.js"

/**
 * Asynchronous message hub for publish-subscribe communication.
 * A Hub<A> is an asynchronous message hub that allows:
 *
 * - Publishers to send messages of type A
 * - Subscribers to receive messages via Stream<A>
 *
 * Key Characteristics:
 * - Backpressure: Built-in backpressure handling
 * - Concurrency: Safe for concurrent publishers and subscribers
 * - Persistence: Messages can be persisted or dropped based on strategy
 * - Functional: Pure functional API with Effect types
 */
export * as Hub from "./Hub.js"

/**
 * Program module containing the main program entry point.
 */
export * as Program from "./Program.js"

/**
 * Storage abstraction layer supporting various backends like IndexedDB and in-memory storage.
 */
export * as Storage from "./Storage.js"

/**
 * Synchronization services for distributed data consistency across replicas.
 */
export * as Sync from "./Sync.js"

/**
 * Example application demonstrating Hub usage.
 */
export * as HubApp from "./examples/HubApp.js"

/**
 * Example Todo application demonstrating the LocalFirst framework.
 */
export * as TodoApp from "./examples/TodoApp.js"
