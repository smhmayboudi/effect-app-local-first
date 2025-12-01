import { Data } from "effect"

/**
 * Error class for storage-related operations.
 * Thrown when there are issues with reading from or writing to storage.
 */
export class StorageError extends Data.TaggedError("StorageError")<{
  /** The error message */
  readonly message: string
  /** The underlying cause of the error, if any */
  readonly cause?: unknown
}> {}

/**
 * Error class for synchronization-related operations.
 * Thrown when there are issues with syncing data between replicas.
 */
export class SyncError extends Data.TaggedError("SyncError")<{
  /** The error message */
  readonly message: string
  /** A code identifying the specific type of sync error */
  readonly code: string
  /** The underlying cause of the error, if any */
  readonly cause?: unknown
}> {}

/**
 * Error class for CRDT (Conflict-free Replicated Data Type) operations.
 * Thrown when there are issues with CRDT operations or merging.
 */
export class CRDTError extends Data.TaggedError("CRDTError")<{
  /** The error message */
  readonly message: string
  /** The operation that caused the error */
  readonly operation: string
  /** The underlying cause of the error, if any */
  readonly cause?: unknown
}> {}

/**
 * Error class for network-related operations.
 * Thrown when there are issues with network connections or communication.
 */
export class NetworkError extends Data.TaggedError("NetworkError")<{
  /** The error message */
  readonly message: string
  /** The HTTP status code, if applicable */
  readonly status?: number
  /** The underlying cause of the error, if any */
  readonly cause?: unknown
}> {}

/**
 * Union type representing all possible error types in the LocalFirst framework.
 */
export type LocalFirstError =
  | StorageError
  | SyncError
  | CRDTError
  | NetworkError
