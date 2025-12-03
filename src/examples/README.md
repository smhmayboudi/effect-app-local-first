# LocalFirst Examples

This directory contains example applications demonstrating different aspects of the LocalFirst framework:

## Available Examples

- **VectorClockExample**: Demonstrates Vector Clock usage for tracking causality in distributed systems
- **CrdtExample**: Shows usage of various Conflict-free Replicated Data Types
- **StorageExample**: Demonstrates the storage system with different backends
- **HubExample**: Shows the pub/sub message hub capabilities
- **CollectionExample**: Demonstrates the collection framework
- **SyncExample**: Shows synchronization between replicas
- **IntegrationExample**: Comprehensive example showing all systems working together
- **HubApp**: Example application using the Hub system
- **TodoApp**: Complete todo application demonstrating the framework

## Usage

Each example can be run independently to understand how different components of the LocalFirst system work:

```bash
tsx src/examples/VectorClockExample.ts
tsx src/examples/CrdtExample.ts
tsx src/examples/StorageExample.ts
# ... etc
```

Each example focuses on different aspects:
- Low-level CRDT operations
- Storage systems
- Sync protocols
- Pub/Sub messaging
- Collection frameworks
- Complete application integration