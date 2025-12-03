/**
 * Example demonstrating CRDT (Conflict-free Replicated Data Types) usage.
 */

import { GSet, LWWRegister, PNCounter, RGA, TwoPhaseSet } from "../Core.js"

console.log("=== CRDT Examples ===")

// LWW Register Example
console.log("\n--- LWW Register Example ---")
const reg1 = LWWRegister.make("value1", "replica1")
const reg2 = new LWWRegister("value2", Date.now() + 1000, "replica2") // Later timestamp
const mergedReg = reg1.merge(reg2)

console.log("Register 1:", reg1.value, "timestamp:", reg1.timestamp)
console.log("Register 2:", reg2.value, "timestamp:", reg2.timestamp)
console.log("Merged register value:", mergedReg.value)

// GSet (Grow-only Set) Example
console.log("\n--- GSet Example ---")
let gset = GSet.empty<string>()
gset = gset.add("item1").add("item2").add("item3")
console.log("GSet contents:", gset.values())

const gset2 = GSet.empty<string>().add("item2").add("item4")
const mergedGSet = gset.merge(gset2)
console.log("Merged GSet contents:", mergedGSet.values())

// PNCounter (Positive-Negative Counter) Example
console.log("\n--- PNCounter Example ---")
let counter = PNCounter.empty()
counter = counter.increment("replica1", 5)
counter = counter.increment("replica2", 3)
counter = counter.decrement("replica1", 2)
console.log("PNCounter value:", counter.value())

// Two-Phase Set Example
console.log("\n--- Two-Phase Set Example ---")
let tpset = TwoPhaseSet.empty<string>()
tpset = tpset.add("item1").add("item2").add("item3")
console.log("Two-Phase Set after additions:", tpset.values())

tpset = tpset.remove("item2")
console.log("Two-Phase Set after removing item2:", tpset.values())

tpset = tpset.add("item2") // This won't work after removal
console.log("Two-Phase Set after trying to re-add item2:", tpset.values())

// RGA (Replicated Growable Array) Example
console.log("\n--- RGA Example ---")
let rga = RGA.empty<string>()
rga = rga.append("first", "replica1")
rga = rga.append("second", "replica1")
rga = rga.insertAt(1, "middle", "replica2")

console.log("RGA contents:", rga.toArray())
console.log("RGA length:", rga.length)

console.log("\n=== End CRDT Examples ===\n")
