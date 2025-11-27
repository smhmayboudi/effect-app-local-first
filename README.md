# Effect Local-First Framework

This is a comprehensive local-first framework built with Effect-TS for developing distributed applications with real-time synchronization and
conflict resolution. The framework provides a set of tools and abstractions for building applications that can work offline-first while
maintaining synchronization capabilities.

## Key Components

  1. Core CRDTs (src/Core.ts):

    - VectorClock: Implements vector clocks for tracking causality between distributed operations
    - LWWRegister: Last-Writer-Wins register for storing single values with timestamp-based conflict resolution
    - GSet: Grow-only Set (a CRDT that only allows adding elements, never removing)
    - ORMap: Observed-Remove Map (a map that can add and remove entries with proper conflict resolution)
    - TwoPhaseSet: Fully commutative Set with tombstones that allows both add and remove operations
    - OrderedSet: Ordered Set with tombstones allowing both add and remove operations while maintaining logical order
    - RGA (Replicated Growable Array): Array-like CRDT supporting append, insert, and remove operations
    - PNCounter: Positive-negative counter that supports both increments and decrements

  2. Hub Messaging System (src/Hub.ts):

    - Asynchronous message hub allowing publishers to send messages and subscribers to receive them via streams
    - Multiple strategies: unbounded, sliding, dropping, and backpressure
    - Built-in backpressure handling and concurrency safety

  3. Storage Layer (src/Storage.ts):

    - Abstract storage backend interface with implementations for IndexedDB and in-memory storage
    - Provides get, set, delete, clear, keys, and watch operations
    - Supports real-time watching of key changes
    - Data model abstraction for custom serialization
    - Support for non-standard backend databases with configurable serialization
    - Raw data operations for low-level access

  4. Synchronization Engine (src/Sync.ts):

    - WebSocket-based real-time synchronization between replicas
    - Manual sync option for offline-only scenarios
    - Conflict detection and status tracking (online/offline/syncing)
    - Server reconciliation for authoritative state management
    - Partial sync support for selective data synchronization
    - Query-based synchronization with customizable filters

  5. Framework Abstraction (src/Framework.ts):

    - Main entry point with dependency injection using Effect's Layer system
    - Collection classes that provide type-safe access to different CRDT types
    - Automatic synchronization and vector clock management
    - Configurable storage and sync backends
    - Fine-grained authorization system with role-based access control
    - Business logic hooks for custom validation and transformation
    - Collection-specific CRDT collections for new CRDT types

## Advanced Features

**Server Reconciliation System**
- Authoritative server state management with conflict detection
- Reconciliation protocol for resolving discrepancies between client and server states
- Vector clock synchronization for maintaining causality
- Conflict resolution strategies (client, server, merge)

**Fine-Grained Authorization**
- Complete AuthorizationService with Subject and Resource types
- Permission model supporting "read", "write", "delete", "admin" and custom permissions
- ACL-based access control with role support
- Integration with Collection operations for secure access

**Partial Sync Support**
- PartialSyncConfig interface for selective synchronization
- Collection and tag-based filtering capabilities
- Timestamp-based sync constraints
- Reduced bandwidth usage through targeted synchronization

**Non-Standard Backend Support**
- DataModel abstraction for custom serialization
- JSON and Binary data models out-of-the-box
- Database configuration support for various backends (IndexedDB, SQLite, Redis, PostgreSQL)
- Custom serialization for domain-specific data structures

**Business Logic Hooks**
- BusinessLogicHook interface with before/after read/write operations
- Validation hooks for data integrity
- Per-collection and global hook support
- Fallback mechanisms for hook failures

## Architecture

The framework uses Effect-TS's dependency injection pattern with the Layer system to provide a clean separation of concerns. The main services
are:

  - LocalFirst: Main service coordinating storage, sync, and hub services
  - StorageService: Handles data persistence across different backends
  - SyncService: Manages real-time synchronization between replicas
  - HubService: Provides messaging capabilities
  - AuthorizationService: Manages access control and permissions

## Examples

The framework includes example applications:

  1. HubApp: Demonstrates the hub messaging system with event publishing and subscription
  2. TodoApp: A complete todo application using ORMap for todos, LWWRegister for user profile, GSet for user tags, and new CRDTs like PNCounter and RGA

## Design Philosophy

The framework emphasizes:
  - Type safety through the Effect ecosystem
  - Functional programming principles
  - Robust offline-first capabilities
  - Conflict-free replicated data types for automatic conflict resolution
  - Modular architecture with pluggable components
  - Real-time synchronization with WebSocket support
  - Enterprise-grade security with fine-grained authorization
  - Flexible storage backends with custom data models
  - Scalable architecture with partial sync capabilities

This framework is designed for building distributed applications that need to work seamlessly in both online and offline scenarios while
maintaining data consistency across multiple replicas.

## Migration Guide for Advanced Features

To leverage the new features:

1. **Authorization**: Enable in LocalFirstConfig with authorization: { enabled: true, defaultSubject: {...} }
2. **Partial Sync**: Configure sync operations with PartialSyncConfig parameters
3. **Business Logic**: Define BusinessLogicHook objects and attach to LocalFirstConfig
4. **Custom Serialization**: Implement DataModel interface for your data formats
5. **New CRDTs**: Import new collection types: TwoPhaseSetCollection, OrderedSetCollection, RGACollection, PNCounterCollection

## Running Code

This template leverages [tsx](https://tsx.is) to allow execution of TypeScript files via NodeJS as if they were written in plain JavaScript.

To execute a file with `tsx`:

```sh
pnpm tsx ./path/to/the/file.ts
```

## Operations

**Building**

To build the package:

```sh
pnpm build
```

**Testing**

To test the package:

```sh
pnpm test
```

## Hub Messaging System

The framework includes a powerful Hub messaging system that allows:

- Publishers to send messages of type A
- Subscribers to receive messages via Stream<A>
- Backpressure handling for robust message flow
- Concurrency-safe operations for multiple publishers/subscribers
- Configurable persistence strategies (unbounded, sliding, dropping, backpressure)

For more details about the Hub system, see [docs/Hub.md](docs/Hub.md).
