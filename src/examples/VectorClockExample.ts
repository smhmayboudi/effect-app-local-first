/**
 * Example demonstrating Vector Clock usage for tracking causality in distributed systems.
 */

import { VectorClock } from "../Core.js"

console.log("=== Vector Clock Example ===")

// Create vector clocks for different replicas
const vc1 = VectorClock.empty().increment("replica1")
const vc2 = VectorClock.empty().increment("replica2")
const vc3 = VectorClock.empty().increment("replica3")

console.log("Initial vector clocks:")
console.log("VC1:", vc1.timestamps)
console.log("VC2:", vc2.timestamps)
console.log("VC3:", vc3.timestamps)

// Simulate causality - replica 2 receives message from replica 1
const vc2Updated = vc2.increment("replica2").increment("replica1") // Received from replica1

console.log("\nAfter replica 2 receives message from replica 1:")
console.log("VC2 updated:", vc2Updated.timestamps)

// Compare clocks
console.log("\nClock comparisons:")
console.log("VC1 vs VC2:", vc1.compare(vc2)) // Should be concurrent (0)
console.log("VC2 vs VC2Updated:", vc2.compare(vc2Updated)) // VC2 is before VC2Updated

// Merge clocks (take max values)
const merged = VectorClock.empty().increment("replica1").increment("replica2")
console.log("\nMerged clock:", merged.timestamps)

console.log("\n=== End Vector Clock Example ===\n")
