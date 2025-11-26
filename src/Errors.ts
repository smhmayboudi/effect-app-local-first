import { Data } from "effect"

export class StorageError extends Data.TaggedError("StorageError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class SyncError extends Data.TaggedError("SyncError")<{
  readonly message: string
  readonly code: string
  readonly cause?: unknown
}> {}

export class CRDTError extends Data.TaggedError("CRDTError")<{
  readonly message: string
  readonly operation: string
  readonly cause?: unknown
}> {}

export class NetworkError extends Data.TaggedError("NetworkError")<{
  readonly message: string
  readonly status?: number
  readonly cause?: unknown
}> {}

export type LocalFirstError =
  | StorageError
  | SyncError
  | CRDTError
  | NetworkError
