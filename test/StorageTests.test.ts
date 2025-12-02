import { Effect, Stream } from "effect"
import { describe, expect, it } from "vitest"
import {
  type DatabaseConfig,
  type DataModel,
  type ExtendedStorageBackend,
  JsonDataModel,
  type StorageBackend,
  type StorageQuery
} from "../src/Storage.js"

describe("Storage System Tests", () => {
  describe("DataModel Interface", () => {
    it("should define serialize and deserialize methods", () => {
      const model: DataModel = {
        serialize: (value: unknown) => new TextEncoder().encode(JSON.stringify(value)),
        deserialize: <T>(data: Uint8Array) => JSON.parse(new TextDecoder().decode(data)) as T
      }

      const testObj = { hello: "world", count: 42 }
      const serialized = model.serialize(testObj)
      expect(serialized).toBeInstanceOf(Uint8Array)

      const deserialized: { hello: string; count: number } = model.deserialize(serialized)
      expect(deserialized.hello).toBe("world")
      expect(deserialized.count).toBe(42)
    })

    it("should work with JsonDataModel", () => {
      const testObj = { data: "test", num: 123 }
      const serialized = JsonDataModel.serialize(testObj)
      expect(serialized).toBeInstanceOf(Uint8Array)

      const deserialized: { data: string; num: number } = JsonDataModel.deserialize(serialized)
      expect(deserialized.data).toBe("test")
      expect(deserialized.num).toBe(123)
    })

    it("should handle primitive types", () => {
      const str = "hello"
      const serializedStr = JsonDataModel.serialize(str)
      const deserializedStr: string = JsonDataModel.deserialize(serializedStr)
      expect(deserializedStr).toBe(str)

      const num = 42
      const serializedNum = JsonDataModel.serialize(num)
      const deserializedNum: number = JsonDataModel.deserialize(serializedNum)
      expect(deserializedNum).toBe(num)

      const bool = true
      const serializedBool = JsonDataModel.serialize(bool)
      const deserializedBool: boolean = JsonDataModel.deserialize(serializedBool)
      expect(deserializedBool).toBe(bool)
    })

    it("should handle complex objects", () => {
      const complexObj = {
        name: "complex",
        nested: {
          value: 123,
          items: ["a", "b", "c"]
        },
        array: [1, 2, 3]
      }

      const serialized = JsonDataModel.serialize(complexObj)
      const deserialized: typeof complexObj = JsonDataModel.deserialize(serialized)

      expect(deserialized.name).toBe(complexObj.name)
      expect(deserialized.nested.value).toBe(complexObj.nested.value)
      expect(deserialized.nested.items).toEqual(complexObj.nested.items)
      expect(deserialized.array).toEqual(complexObj.array)
    })
  })

  describe("StorageQuery Interface", () => {
    it("should define different query types", () => {
      const rangeQuery: StorageQuery = {
        type: "range",
        params: {
          start: "key1",
          end: "key5",
          limit: 10
        }
      }

      const filterQuery: StorageQuery = {
        type: "filter",
        params: {
          field: "status",
          value: "active"
        }
      }

      const aggregateQuery: StorageQuery = {
        type: "aggregate",
        params: {
          operation: "count",
          field: "status"
        }
      }

      const customQuery: StorageQuery = {
        type: "custom",
        params: {
          query: "SELECT * FROM items WHERE active = 1",
          options: { timeout: 5000 }
        }
      }

      expect(rangeQuery.type).toBe("range")
      expect(filterQuery.type).toBe("filter")
      expect(aggregateQuery.type).toBe("aggregate")
      expect(customQuery.type).toBe("custom")
    })

    it("should accept arbitrary parameters", () => {
      const query: StorageQuery = {
        type: "range",
        params: {
          customField: "customValue",
          nested: {
            deep: "value",
            number: 42
          },
          array: [1, 2, 3]
        }
      }

      expect(query.params.customField).toBe("customValue")
      expect((query.params.nested as { deep: string; number: number }).deep).toBe("value")
      expect((query.params.nested as { deep: string; number: number }).number).toBe(42)
      expect((query.params.array as Array<number>)[0]).toBe(1)
    })
  })

  describe("DatabaseConfig Interface", () => {
    it("should support different database types", () => {
      const indexedDbConfig: DatabaseConfig = {
        type: "indexeddb",
        options: {
          version: 1,
          name: "local-db"
        }
      }

      const sqliteConfig: DatabaseConfig = {
        type: "sqlite",
        options: {
          path: "/path/to/db.sqlite",
          encryption: true
        }
      }

      const redisConfig: DatabaseConfig = {
        type: "redis",
        options: {
          host: "localhost",
          port: 6379,
          password: "secret"
        }
      }

      const postgresConfig: DatabaseConfig = {
        type: "postgres",
        options: {
          host: "localhost",
          port: 5432,
          username: "user",
          password: "pass",
          database: "mydb"
        }
      }

      const customConfig: DatabaseConfig = {
        type: "custom",
        options: {
          url: "custom://connection",
          adapter: "custom-adapter"
        }
      }

      expect(indexedDbConfig.type).toBe("indexeddb")
      expect(sqliteConfig.type).toBe("sqlite")
      expect(redisConfig.type).toBe("redis")
      expect(postgresConfig.type).toBe("postgres")
      expect(customConfig.type).toBe("custom")
    })

    it("should allow arbitrary options", () => {
      const config: DatabaseConfig = {
        type: "indexeddb",
        options: {
          version: 2,
          upgrade: true,
          features: ["encryption", "compression"],
          settings: {
            maxConnections: 10,
            timeout: 5000
          }
        }
      }

      expect(config.options.version).toBe(2)
      expect(config.options.upgrade).toBe(true)
      expect(Array.isArray(config.options.features)).toBe(true)
      expect((config.options.settings as { maxConnections: number }).maxConnections).toBe(10)
    })

    it("should support custom data model in config", () => {
      const config: DatabaseConfig = {
        type: "custom",
        options: {},
        dataModel: JsonDataModel
      }

      expect(config.dataModel).toBeDefined()
      expect(config.dataModel!.serialize).toBeDefined()
      expect(config.dataModel!.deserialize).toBeDefined()
    })
  })

  describe("StorageBackend Interface", () => {
    it("should define core storage operations", () => {
      // This is an interface test, just ensuring correct structure
      const backend: StorageBackend = {
        get: (key: string) => {
          return Effect.succeed("test")
        },
        set: (key: string, value: unknown) => {
          return Effect.void
        },
        delete: (key: string) => {
          return Effect.void
        },
        keys: () => {
          return Effect.succeed(["key1", "key2"] as const)
        },
        clear: () => {
          return Effect.void
        },
        watch: (key: string) => {
          // Mock implementation for watch using Stream
          return Stream.succeed("watch result")
        }
      }

      expect(backend.get).toBeDefined()
      expect(backend.set).toBeDefined()
      expect(backend.delete).toBeDefined()
      expect(backend.keys).toBeDefined()
      expect(backend.clear).toBeDefined()
    })
  })

  describe("ExtendedStorageBackend Interface", () => {
    it("should extend StorageBackend with additional methods", () => {
      const backend: ExtendedStorageBackend = {
        get: (key: string) => {
          return Effect.succeed("test")
        },
        set: (key: string, value: unknown) => {
          return Effect.void
        },
        delete: (key: string) => {
          return Effect.void
        },
        keys: () => {
          return Effect.succeed(["key1", "key2"] as const)
        },
        clear: () => {
          return Effect.void
        },
        watch: (key: string) => {
          // Mock implementation for watch using Stream
          return Stream.succeed("watch result")
        },
        getWithModel: <T>(key: string, model: DataModel) => {
          return Effect.succeed({} as T)
        },
        setWithModel: (key: string, value: unknown, model: DataModel) => {
          return Effect.void
        },
        getRaw: (key: string) => {
          return Effect.succeed(new Uint8Array())
        },
        setRaw: (key: string, data: Uint8Array) => {
          return Effect.void
        },
        query: (query: StorageQuery) => {
          return Effect.succeed([])
        }
      }

      expect(backend.get).toBeDefined()
      expect(backend.set).toBeDefined()
      expect(backend.delete).toBeDefined()
      expect(backend.keys).toBeDefined()
      expect(backend.clear).toBeDefined()
      // Extended methods
      expect(backend.getWithModel).toBeDefined()
      expect(backend.setWithModel).toBeDefined()
      expect(backend.getRaw).toBeDefined()
      expect(backend.setRaw).toBeDefined()
      expect(backend.query).toBeDefined()
    })

    it("should use DataModel for model-specific operations", () => {
      const backend: ExtendedStorageBackend = {
        get: (key: string) => {
          return Effect.succeed("test")
        },
        set: (key: string, value: unknown) => {
          return Effect.void
        },
        delete: (key: string) => {
          return Effect.void
        },
        keys: () => {
          return Effect.succeed(["key1", "key2"] as const)
        },
        clear: () => {
          return Effect.void
        },
        watch: (key: string) => {
          // Mock implementation for watch using Stream
          return Stream.succeed("watch result")
        },
        getWithModel: <T>(key: string, model: DataModel) => {
          // Simulate getting raw data and deserializing with provided model
          const rawData = new TextEncoder().encode(JSON.stringify({ data: "test" }))
          return Effect.succeed(model.deserialize<T>(rawData))
        },
        setWithModel: (key: string, value: unknown, model: DataModel) => {
          // Simulate serializing with provided model and storing
          model.serialize(value)
          // Store the serialized data
          return Effect.void
        },
        getRaw: (key: string) => {
          return Effect.succeed(new Uint8Array([72, 101, 108, 108, 111])) // "Hello" in bytes
        },
        setRaw: (key: string, data: Uint8Array) => {
          return Effect.void
        },
        query: (query: StorageQuery) => {
          return Effect.succeed([{ result: "data" }])
        }
      }

      // Test the model-specific operations
      expect(backend.getWithModel).toBeDefined()
      expect(backend.setWithModel).toBeDefined()
    })
  })

  describe("Storage System Integration", () => {
    it("should support multiple data models", () => {
      // Define different models
      const jsonModel: DataModel = JsonDataModel

      // Simple binary model that just encodes strings
      const binaryModel: DataModel = {
        serialize: (value: unknown) => {
          if (typeof value === "string") {
            return new TextEncoder().encode(value)
          }
          return new TextEncoder().encode(JSON.stringify(value))
        },
        deserialize: <T>(data: Uint8Array) => {
          const str = new TextDecoder().decode(data)
          try {
            return JSON.parse(str) as T
          } catch {
            return str as T
          }
        }
      }

      expect(jsonModel).toBeDefined()
      expect(binaryModel).toBeDefined()
    })

    it("should validate storage query types", () => {
      const queries: Array<StorageQuery> = [
        { type: "range", params: { start: "a", end: "z" } },
        { type: "filter", params: { field: "status", op: "=", val: "active" } },
        { type: "aggregate", params: { func: "count", field: "id" } },
        { type: "custom", params: { sql: "SELECT * FROM table" } }
      ]

      expect(queries[0].type).toBe("range")
      expect(queries[1].type).toBe("filter")
      expect(queries[2].type).toBe("aggregate")
      expect(queries[3].type).toBe("custom")
    })
  })
})
