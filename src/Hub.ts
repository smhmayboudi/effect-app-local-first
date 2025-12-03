import { Context, Data, Effect, Layer, Queue, Stream } from "effect"

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
export interface Hub<A> {
  /**
   * Publish a single message to the hub
   */
  readonly publish: (message: A) => Effect.Effect<void, HubError>

  /**
   * Publish multiple messages to the hub
   */
  readonly publishAll: (messages: Iterable<A>) => Effect.Effect<void, HubError>

  /**
   * Subscribe to messages from the hub as a Stream
   */
  readonly subscribe: () => Stream.Stream<A, HubError>

  /**
   * Get the current subscriber count
   */
  readonly subscriberCount: () => Effect.Effect<number>

  /**
   * Get the hub size (if applicable to the implementation)
   */
  readonly size: () => Effect.Effect<number>
}

/**
 * Internal interface for the actual Hub implementation
 */
interface InternalHub<A> extends Hub<A> {
  readonly unsafePublish: (message: A) => void
  readonly unsafePublishAll: (messages: Iterable<A>) => void
}

/**
 * Base interface for Hub strategies
 */
interface BaseHubStrategy {
  readonly _tag: string
}

/**
 * Represents different strategies for hub capacity and behavior using effect-ts patterns
 */
export interface UnboundedStrategy extends BaseHubStrategy {
  readonly _tag: "unbounded"
}

export interface SlidingStrategy extends BaseHubStrategy {
  readonly _tag: "sliding"
  readonly capacity: number
}

export interface DroppingStrategy extends BaseHubStrategy {
  readonly _tag: "dropping"
  readonly capacity: number
}

export interface BackpressureStrategy extends BaseHubStrategy {
  readonly _tag: "backpressure"
  readonly capacity: number
}

export type HubStrategy = UnboundedStrategy | SlidingStrategy | DroppingStrategy | BackpressureStrategy

/**
 * Helper functions to create HubStrategy instances using effect-ts patterns
 */
export const HubStrategy = {
  unbounded: (): UnboundedStrategy => ({ _tag: "unbounded" }),
  sliding: (capacity: number): SlidingStrategy => ({ _tag: "sliding", capacity }),
  dropping: (capacity: number): DroppingStrategy => ({ _tag: "dropping", capacity }),
  backpressure: (capacity: number): BackpressureStrategy => ({ _tag: "backpressure", capacity })
} as const

/**
 * Error class for Hub-specific errors
 */
export class HubError extends Data.TaggedError("HubError")<{
  readonly message: string
  readonly operation: string
  readonly cause?: unknown
}> {}

/**
 * Creates an unbounded hub that can store an unlimited number of messages
 */
export const unbounded = <A>(): Effect.Effect<Hub<A>> =>
  Effect.gen(function*() {
    const queue = yield* Queue.unbounded<A>()

    const hub: InternalHub<A> = {
      publish: (message: A) =>
        Queue.offer(queue, message).pipe(
          Effect.mapError((cause) =>
            new HubError({
              message: "Failed to publish message to hub",
              operation: "publish",
              cause
            })
          )
        ),

      publishAll: (messages: Iterable<A>) =>
        Queue.offerAll(queue, messages).pipe(
          Effect.mapError((cause) =>
            new HubError({
              message: "Failed to publish messages to hub",
              operation: "publishAll",
              cause
            })
          )
        ),

      subscribe: () =>
        Stream.fromQueue(queue).pipe(
          Stream.mapError((cause) =>
            new HubError({
              message: "Failed to subscribe to hub",
              operation: "subscribe",
              cause
            })
          )
        ),

      subscriberCount: () => Effect.succeed(0), // Unbounded queue doesn't track subscribers

      size: () => Queue.size(queue),

      unsafePublish: (message: A) => {
        // This is an unsafe version for internal use
        Effect.runSync(Effect.either(Queue.offer(queue, message)))
      },

      unsafePublishAll: (messages: Iterable<A>) => {
        // This is an unsafe version for internal use
        Effect.runSync(Effect.either(Queue.offerAll(queue, messages)))
      }
    }

    return hub
  })

/**
 * Creates a sliding hub with a fixed capacity that drops old messages when full
 */
export const sliding = <A>(capacity: number): Effect.Effect<Hub<A>> =>
  Effect.gen(function*() {
    const queue = yield* Queue.sliding<A>(capacity)

    const hub: InternalHub<A> = {
      publish: (message: A) =>
        Queue.offer(queue, message).pipe(
          Effect.mapError((cause) =>
            new HubError({
              message: "Failed to publish message to hub",
              operation: "publish",
              cause
            })
          )
        ),

      publishAll: (messages: Iterable<A>) =>
        Queue.offerAll(queue, messages).pipe(
          Effect.mapError((cause) =>
            new HubError({
              message: "Failed to publish messages to hub",
              operation: "publishAll",
              cause
            })
          )
        ),

      subscribe: () =>
        Stream.fromQueue(queue).pipe(
          Stream.mapError((cause) =>
            new HubError({
              message: "Failed to subscribe to hub",
              operation: "subscribe",
              cause
            })
          )
        ),

      subscriberCount: () => Effect.succeed(0),

      size: () => Queue.size(queue),

      unsafePublish: (message: A) => {
        Effect.runSync(Effect.either(Queue.offer(queue, message)))
      },

      unsafePublishAll: (messages: Iterable<A>) => {
        Effect.runSync(Effect.either(Queue.offerAll(queue, messages)))
      }
    }

    return hub
  })

/**
 * Creates a dropping hub with a fixed capacity that drops new messages when full
 */
export const dropping = <A>(capacity: number): Effect.Effect<Hub<A>> =>
  Effect.gen(function*() {
    const queue = yield* Queue.dropping<A>(capacity)

    const hub: InternalHub<A> = {
      publish: (message: A) =>
        Queue.offer(queue, message).pipe(
          Effect.mapError((cause) =>
            new HubError({
              message: "Failed to publish message to hub",
              operation: "publish",
              cause
            })
          )
        ),

      publishAll: (messages: Iterable<A>) =>
        Queue.offerAll(queue, messages).pipe(
          Effect.mapError((cause) =>
            new HubError({
              message: "Failed to publish messages to hub",
              operation: "publishAll",
              cause
            })
          )
        ),

      subscribe: () =>
        Stream.fromQueue(queue).pipe(
          Stream.mapError((cause) =>
            new HubError({
              message: "Failed to subscribe to hub",
              operation: "subscribe",
              cause
            })
          )
        ),

      subscriberCount: () => Effect.succeed(0),

      size: () => Queue.size(queue),

      unsafePublish: (message: A) => {
        Effect.runSync(Effect.either(Queue.offer(queue, message)))
      },

      unsafePublishAll: (messages: Iterable<A>) => {
        Effect.runSync(Effect.either(Queue.offerAll(queue, messages)))
      }
    }

    return hub
  })

/**
 * Creates a backpressure hub with a fixed capacity that blocks publishers when full
 */
export const backpressure = <A>(capacity: number): Effect.Effect<Hub<A>> =>
  Effect.gen(function*() {
    const queue = yield* Queue.bounded<A>(capacity)

    const hub: InternalHub<A> = {
      publish: (message: A) =>
        Queue.offer(queue, message).pipe(
          Effect.mapError((cause) =>
            new HubError({
              message: "Failed to publish message to hub",
              operation: "publish",
              cause
            })
          )
        ),

      publishAll: (messages: Iterable<A>) =>
        Queue.offerAll(queue, messages).pipe(
          Effect.mapError((cause) =>
            new HubError({
              message: "Failed to publish messages to hub",
              operation: "publishAll",
              cause
            })
          )
        ),

      subscribe: () =>
        Stream.fromQueue(queue).pipe(
          Stream.mapError((cause) =>
            new HubError({
              message: "Failed to subscribe to hub",
              operation: "subscribe",
              cause
            })
          )
        ),

      subscriberCount: () => Effect.succeed(0),

      size: () => Queue.size(queue),

      unsafePublish: (message: A) => {
        Effect.runSync(Effect.either(Queue.offer(queue, message)))
      },

      unsafePublishAll: (messages: Iterable<A>) => {
        Effect.runSync(Effect.either(Queue.offerAll(queue, messages)))
      }
    }

    return hub
  })

/**
 * Creates a hub based on the specified strategy
 */
export const makeWithStrategy = <A>(strategy: HubStrategy): Effect.Effect<Hub<A>> =>
  strategy._tag === "sliding"
    ? sliding<A>(strategy.capacity)
    : strategy._tag === "dropping"
    ? dropping<A>(strategy.capacity)
    : strategy._tag === "backpressure"
    ? backpressure<A>(strategy.capacity)
    : unbounded<A>()

/**
 * Hub service for dependency injection
 */
export interface HubService {
  readonly createHub: <A>(strategy?: HubStrategy) => Effect.Effect<Hub<A>>
}

export const HubService = Context.GenericTag<HubService>("@core/HubService")

/**
 * Layer to provide HubService
 */
export const HubServiceLive = Layer.succeed(
  HubService,
  {
    createHub: <A>(strategy?: HubStrategy) => makeWithStrategy<A>(strategy ?? HubStrategy.unbounded())
  }
)
