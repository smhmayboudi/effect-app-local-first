# Architecture Overview

This project demonstrates a distributed local-first application architecture with conflict-free replicated data types (CRDTs), real-time synchronization, and storage capabilities.

## High-Level Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Application   │     │   Framework      │     │   Core CRDTs    │
│   Layer         │ ◄─► │   Layer          │ ◄─► │   Layer         │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                       │                        │
        ▼                       ▼                        ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   UI Layer      │     │   Sync Layer     │     │   Storage       │
│                 │     │                  │     │   Layer         │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                │
                                ▼
                        ┌──────────────────┐
                        │   Hub Layer      │
                        │                  │
                        └──────────────────┘
```

## Core Components

### 1. Core Layer (`Core.ts`)
The foundation of the system implementing various Conflict-free Replicated Data Types (CRDTs):

- **VectorClock**: Distributed logical clock for tracking causal relationships
- **LWWRegister (Last-Write-Wins Register)**: Ensures eventual consistency by timestamp
- **GSet (Grow-Only Set)**: Set that only supports additions
- **TwoPhaseSet**: Set supporting both additions and removals
- **TombstoneSet**: Set preserving ordering with tombstones for removals
- **RGA (Replicated Growable Array)**: Sequence CRDT for ordered data
- **PNCounter (Positive-Negative Counter)**: Supports both increment and decrement operations

### 2. Framework Layer (`Framework.ts`)
High-level abstractions and collections built on top of core CRDTs:

- **Collection Framework**: Generic collections based on CRDTs
  - `GSetCollection`: Grow-only set collection
  - `LWWRegisterCollection`: Register collection
  - `ORMapCollection`: Observed-Remove Map collection
  - `PNCounterCollection`: Counter collection
  - `RGACollection`: Replicated array collection
  - `TwoPhaseSetCollection`: Two-phase set collection
  - `OrderedSetCollection`: Ordered set collection

- **Access Control List (ACL)**: Permission-based access control
- **Authorization System**: Policy-based authorization
- **Conflict Resolution**: Automatic conflict detection and resolution
- **CRDT Operations Framework**: Operations and transformations for CRDTs

### 3. Storage Layer (`Storage.ts`)
Persistent storage abstraction layer:

- **DataModel Interface**: Serialization/deserialization abstraction
  - `JsonDataModel`: JSON-based serialization
  - Custom data models for different formats

- **StorageBackends**:
  - `StorageBackend`: Basic storage operations interface
  - `ExtendedStorageBackend`: Enhanced storage with model support
  - `StorageService`: Full service with all operations

- **Implementations**:
  - `IndexedDBLive`: Browser IndexedDB implementation
  - `MemoryStorageLive`: In-memory implementation for testing

- **StorageQuery Interface**: Query abstraction for different storage types
- **DatabaseConfig Interface**: Configuration for different databases

### 4. Synchronization Layer (`Sync.ts`)
Distributed synchronization system:

- **VectorClock Integration**: Causal ordering of operations
- **Operation Types**: Different types of sync operations
- **Reconciliation**: Conflict detection and resolution
- **Replica Management**: Handling multiple replicas
- **Sync Strategies**: Different synchronization approaches
- **Conflict Resolution**: Automatic and manual conflict handling

### 5. Hub Layer (`Hub.ts`)
Real-time communication and event broadcasting:

- **HubService**: Centralized or distributed event broadcasting
- **Hub Strategies**: Different buffering strategies
  - `unbounded`: Unlimited buffer size
  - `sliding`: Fixed-size sliding window
  - `dropping`: Drop new messages when full
  - `backpressure`: Block publishers when full
- **Pub/Sub Pattern**: Publish/subscribe messaging system
- **Stream-based**: Reactive streaming for real-time updates

## Architecture Patterns

### Local-First Architecture
- Data stored locally first, synchronized across replicas
- Offline-first with eventual consistency
- Conflict resolution through CRDTs

### Layered Architecture
- Clear separation of concerns between layers
- Each layer abstracts complexity for higher layers
- Interface-based design for flexibility

### Event-Driven Architecture
- Operations as events propagated through system
- Real-time updates via Hub layer
- Reactive programming with Effect streams

### Capability-Based Security
- ACL-based access control
- Permission-based authorization
- Fine-grained access control to resources

## Integration Points

### CRDT ↔ Storage
- CRDTs serialize to storage via DataModel
- Storage provides persistence for CRDT state
- Conflict-free operations maintained through sync

### Sync ↔ Hub
- Real-time operation broadcasting
- Event propagation across replicas
- Reconciliation of distributed state

### Framework ↔ Core
- High-level collections built on primitive CRDTs
- Automatic conflict resolution
- Type-safe operations

## Key Design Principles

1. **Eventual Consistency**: All replicas converge to same state
2. **Offline-First**: Functionality without network connectivity
3. **Type Safety**: Full TypeScript type checking
4. **Modularity**: Each layer can be replaced independently
5. **Performance**: Optimized for local operations
6. **Scalability**: Support for multiple replicas and users
7. **Security**: Built-in access control and authorization

## Data Flow

```
User Action → Framework Layer → Core CRDT → Storage Layer
      ↓            ↓                ↓            ↓
   Conflict    Collection        Operation   Persist
      ↓            ↓                ↓            ↓
   Resolution → Sync Layer → Hub Layer → Reconciliation
```

1. User performs action
2. Framework translates to CRDT operation
3. Core CRDT applies operation
4. Storage persists state
5. Sync propagates to other replicas
6. Hub broadcasts real-time changes
7. Conflicts resolved automatically
