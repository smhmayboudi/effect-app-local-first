import { describe, expect, it } from "vitest"
import { GSet, LWWRegister, OrderedSet, PNCounter, RGA, TwoPhaseSet } from "../src/Core.js"

describe("CRDT Tests", () => {
  describe("RGA (Replicated Growable Array)", () => {
    it("should create an empty RGA", () => {
      const rga = RGA.empty<number>()
      expect(rga.length).toBe(0)
      expect(rga.toArray()).toEqual([])
    })

    it("should append elements to the RGA", () => {
      let rga = RGA.empty<string>()
      rga = rga.append("a", "replica1")
      rga = rga.append("b", "replica1")
      rga = rga.append("c", "replica1")

      expect(rga.length).toBe(3)
      expect(rga.toArray()).toEqual(["a", "b", "c"])
    })

    it("should insert elements at specific positions", () => {
      let rga = RGA.empty<string>()
      rga = rga.append("a", "replica1")
      rga = rga.append("c", "replica1")

      // Insert "b" at position 1
      rga = rga.insertAt(1, "b", "replica1")

      expect(rga.toArray()).toEqual(["a", "b", "c"])
    })

    it("should remove elements at specific positions", () => {
      let rga = RGA.empty<string>()
      rga = rga.append("a", "replica1")
      rga = rga.append("b", "replica1")
      rga = rga.append("c", "replica1")

      // Remove element at position 1 ("b")
      rga = rga.removeAt(1)

      expect(rga.toArray()).toEqual(["a", "c"])
    })

    it("should get elements at specific positions", () => {
      let rga = RGA.empty<string>()
      rga = rga.append("a", "replica1")
      rga = rga.append("b", "replica1")
      rga = rga.append("c", "replica1")

      expect(rga.get(0)).toBe("a")
      expect(rga.get(1)).toBe("b")
      expect(rga.get(2)).toBe("c")
    })

    it("should handle empty array operations", () => {
      const rga = RGA.empty<string>()

      expect(rga.length).toBe(0)
      expect(rga.toArray()).toEqual([])
      expect(rga.get(0)).toBeUndefined()
      expect(rga.removeAt(0)).toEqual(rga) // No change when removing from empty
    })

    it("should merge two RGAs correctly", () => {
      let rga1 = RGA.empty<string>()
      rga1 = rga1.append("a", "replica1")
      rga1 = rga1.append("b", "replica1")

      let rga2 = RGA.empty<string>()
      rga2 = rga2.append("x", "replica2")
      rga2 = rga2.append("y", "replica2")

      const merged = rga1.merge(rga2)

      // Both elements from both RGAs should exist in the merged one
      expect(merged.length).toBeGreaterThanOrEqual(2)
      const arr = merged.toArray()
      expect(arr.some((item) => item === "a")).toBeTruthy()
      expect(arr.some((item) => item === "b")).toBeTruthy()
      expect(arr.some((item) => item === "x")).toBeTruthy()
      expect(arr.some((item) => item === "y")).toBeTruthy()
    })
  })

  describe("PNCounter (Positive-Negative Counter)", () => {
    it("should start with a value of 0", () => {
      const counter = PNCounter.empty()
      expect(counter.value()).toBe(0)
    })

    it("should increment values", () => {
      let counter = PNCounter.empty()
      counter = counter.increment("replica1")
      counter = counter.increment("replica1", 5)

      expect(counter.value()).toBe(6)
    })

    it("should decrement values", () => {
      let counter = PNCounter.empty()
      counter = counter.increment("replica1", 10)
      counter = counter.decrement("replica1", 3)

      expect(counter.value()).toBe(7)
    })

    it("should merge counters correctly", () => {
      let counter1 = PNCounter.empty()
      counter1 = counter1.increment("replica1", 5)
      counter1 = counter1.decrement("replica1", 2)

      let counter2 = PNCounter.empty()
      counter2 = counter2.increment("replica2", 3)
      counter2 = counter2.decrement("replica2", 1)

      const merged = counter1.merge(counter2)
      // Should be (5-2) + (3-1) = 3 + 2 = 5
      expect(merged.value()).toBe(5)
    })

    it("should handle multiple replicas independently", () => {
      let counter = PNCounter.empty()
      counter = counter.increment("replica1", 10)
      counter = counter.increment("replica2", 5)
      counter = counter.decrement("replica1", 3)
      counter = counter.decrement("replica2", 2)

      // Total should be (10-3) + (5-2) = 7 + 3 = 10
      expect(counter.value()).toBe(10)
    })
  })

  describe("TwoPhaseSet (Add-Remove Set with Tombstones)", () => {
    it("should start as an empty set", () => {
      const set = TwoPhaseSet.empty<string>()
      expect(set.values()).toEqual([])
      expect(set.has("item")).toBe(false)
    })

    it("should add elements", () => {
      let set = TwoPhaseSet.empty<string>()
      set = set.add("item1")
      set = set.add("item2")

      expect(set.has("item1")).toBe(true)
      expect(set.has("item2")).toBe(true)
      expect(set.values()).toContain("item1")
      expect(set.values()).toContain("item2")
    })

    it("should remove elements", () => {
      let set = TwoPhaseSet.empty<string>()
      set = set.add("item1")
      set = set.add("item2")
      set = set.remove("item1")

      expect(set.has("item1")).toBe(false)
      expect(set.has("item2")).toBe(true)
      expect(set.values()).toEqual(["item2"])
    })

    it("should not re-add removed elements", () => {
      let set = TwoPhaseSet.empty<string>()
      set = set.add("item1")
      set = set.remove("item1")
      set = set.add("item1") // Try to re-add

      expect(set.has("item1")).toBe(false)
    })

    it("should merge two sets correctly", () => {
      let set1 = TwoPhaseSet.empty<string>()
      set1 = set1.add("a")
      set1 = set1.add("b")
      set1 = set1.remove("a") // "a" is tombstoned in set1

      let set2 = TwoPhaseSet.empty<string>()
      set2 = set2.add("c")
      set2 = set2.add("b") // "b" is in both sets

      const merged = set1.merge(set2)

      // "b" and "c" should be present, "a" should not (it was tombstoned)
      expect(merged.has("a")).toBe(false)
      expect(merged.has("b")).toBe(true)
      expect(merged.has("c")).toBe(true)
    })
  })

  describe("OrderedSet (Set with tombstones and ordering)", () => {
    it("should start as an empty set", () => {
      const set = OrderedSet.empty<string>()
      expect(set.values()).toEqual([])
      expect(set.has("id1")).toBe(false)
    })

    it("should add elements with IDs", () => {
      let set = OrderedSet.empty<string>()
      set = set.add("id1", "value1", Date.now(), "replica1")
      set = set.add("id2", "value2", Date.now() + 1, "replica1")

      expect(set.has("id1")).toBe(true)
      expect(set.has("id2")).toBe(true)
      expect(set.get("id1")).toBe("value1")
      expect(set.get("id2")).toBe("value2")
    })

    it("should remove elements with tombstones", () => {
      let set = OrderedSet.empty<string>()
      set = set.add("id1", "value1", Date.now(), "replica1")
      set = set.add("id2", "value2", Date.now() + 1, "replica1")
      set = set.remove("id1")

      expect(set.has("id1")).toBe(false)
      expect(set.has("id2")).toBe(true)
      expect(set.get("id1")).toBeUndefined()
      expect(set.get("id2")).toBe("value2")
    })

    it("should return values in order", () => {
      let set = OrderedSet.empty<string>()
      const time1 = Date.now()
      const time2 = time1 + 10
      const time3 = time1 + 5 // Middle timestamp

      set = set.add("id1", "value1", time1, "replica1")
      set = set.add("id3", "value3", time3, "replica1") // Insert with middle timestamp
      set = set.add("id2", "value2", time2, "replica1")

      const values = set.values()
      // Should be ordered by timestamp: value1, value3, value2
      expect(values).toEqual([
        { id: "id1", value: "value1" },
        { id: "id3", value: "value3" },
        { id: "id2", value: "value2" }
      ])
    })

    it("should merge sets correctly", () => {
      let set1 = OrderedSet.empty<string>()
      set1 = set1.add("id1", "value1", Date.now(), "replica1")
      set1 = set1.remove("id1")
      set1 = set1.add("id2", "value2", Date.now() + 10, "replica1")

      let set2 = OrderedSet.empty<string>()
      set2 = set2.add("id3", "value3", Date.now() + 5, "replica2")
      set2 = set2.add("id1", "value1", Date.now() + 2, "replica2")

      const merged = set1.merge(set2)

      // Both id2 and id3 should be present, id1 should not because it was tombstoned in set1
      // and TwoPhaseSet doesn't allow re-adding tombstoned elements
      expect(merged.has("id2")).toBe(true)
      expect(merged.has("id3")).toBe(true)
      expect(merged.has("id1")).toBe(false)
    })
  })

  // Also test existing CRDTs to make sure we didn't break anything
  describe("GSet (Grow-only Set)", () => {
    it("should add elements", () => {
      let set = GSet.empty<string>()
      set = set.add("item1")
      set = set.add("item2")

      expect(set.has("item1")).toBe(true)
      expect(set.has("item2")).toBe(true)
      expect(set.values()).toContain("item1")
      expect(set.values()).toContain("item2")
    })

    it("should merge correctly", () => {
      let set1 = GSet.empty<string>()
      set1 = set1.add("a")
      set1 = set1.add("b")

      let set2 = GSet.empty<string>()
      set2 = set2.add("c")
      set2 = set2.add("b") // duplicate with set1

      const merged = set1.merge(set2)
      expect(merged.values().length).toBe(3) // a, b, c
      expect(merged.has("a")).toBe(true)
      expect(merged.has("b")).toBe(true)
      expect(merged.has("c")).toBe(true)
    })
  })

  describe("LWWRegister (Last-Write-Wins Register)", () => {
    it("should use the latest value based on timestamp", () => {
      const time1 = Date.now()
      const time2 = time1 + 10

      const reg1 = LWWRegister.make("value1", "replica1")
      const reg2 = new LWWRegister("value2", time2, "replica2")

      const merged = reg1.merge(reg2)
      expect(merged.get()).toBe("value2")
    })

    it("should use replicaId as tie-breaker for same timestamps", () => {
      const time = Date.now()

      const reg1 = new LWWRegister("value1", time, "replica1")
      const reg2 = new LWWRegister("value2", time, "replica2")

      const merged = reg1.merge(reg2)
      // replica2 > replica1 alphabetically, so value2 should win
      expect(merged.get()).toBe("value2")
    })
  })
})
