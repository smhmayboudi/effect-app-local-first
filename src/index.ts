/**
 * Vector Clock implementation for distributed systems.
 * A vector clock is a data structure that provides a causal ordering of events in a distributed system.
 * It maintains a logical clock per node/replica, allowing detection of causality between events.
 */
export * as Core from "./Core.js"

/**
 * Error class for storage-related operations.
 * Thrown when there are issues with reading from or writing to storage.
 */
export * as Errors from "./Errors.js"

/**
 * Authorization and Access Control Types
 */
export * as Framework from "./Framework.js"

/**
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
 * Main program entry point.
 * This file demonstrates a simple Effect program that logs "Hello, World!".
 */
export * as Program from "./Program.js"

/**
 * Data model interface for different storage systems.
 * Defines how data is serialized to and deserialized from bytes.
 */
export * as Storage from "./Storage.js"

/**
 * Represents a data conflict that occurs during synchronization.
 * This class is used when local and remote values differ during sync operations.
 */
export * as Sync from "./Sync.js"

/**
 * Example demonstrating Collection Framework usage.
 */
export * as CollectionExample from "./examples/CollectionExample.js"

/**
 * Example demonstrating CRDT (Conflict-free Replicated Data Types) usage.
 */
export * as CrdtExample from "./examples/CrdtExample.js"

/**
 * Example demonstrating Hub (Pub/Sub) System usage.
 */
export * as HubExample from "./examples/HubExample.js"

/**
 * Comprehensive example demonstrating integration of multiple systems.
 * This example shows how VectorClocks, CRDTs, Storage, Sync, and Collections work together.
 */
export * as IntegrationExample from "./examples/IntegrationExample.js"

/**
 * Example demonstrating Storage System usage.
 */
export * as StorageExample from "./examples/StorageExample.js"

/**
 * Example demonstrating Sync (Synchronization) System usage.
 */
export * as SyncExample from "./examples/SyncExample.js"

/**
 * Example demonstrating Vector Clock usage for tracking causality in distributed systems.
 */
export * as VectorClockExample from "./examples/VectorClockExample.js"
