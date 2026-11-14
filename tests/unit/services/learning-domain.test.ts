import { describe, it, expect, beforeEach } from "vitest";
import {
  learnVar,
  lookupVar,
  invalidateVar,
} from "../../../src/services/learning.js";
import type { IPersistentStore } from "../../../src/services/persistent-store.js";

function createStore(): { store: IPersistentStore; data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    store: {
      get: async (key) => data.get(key) ?? null,
      set: async (key, value) => { data.set(key, value); },
      delete: async (key) => { data.delete(key); },
      getAll: async () => Object.fromEntries(data),
      merge: async (entries) => { for (const [key, value] of Object.entries(entries)) data.set(key, value); },
    },
  };
}

describe("learned variable domain isolation", () => {
  let data: Map<string, string>;
  let store: IPersistentStore;

  beforeEach(() => {
    const created = createStore();
    data = created.data;
    store = created.store;
  });

  it("stores the domain with a learned mapping", async () => {
    await learnVar("kemiskinan", "3200", {
      var_id: 936,
      title: "Persentase Penduduk Miskin Provinsi Jawa Barat",
      sub_name: "Kemiskinan",
    }, store);
    const stored = [...data.values()]
      .map((value) => JSON.parse(value) as { var_id: number; domain?: string })
      .find((entry) => entry.var_id === 936);
    expect(stored?.domain).toBe("3200");
  });

  it("discards a legacy provincial mapping without a domain", async () => {
    data.set("ipm:3500", JSON.stringify({ var_id: 413, title: "old mapping", sub_name: "IPM" }));
    const result = await lookupVar("ipm", "3500", store);
    expect(result).toBeNull();
    expect(data.has("ipm:3500")).toBe(false);
  });

  it("discards a mapping learned for a different domain", async () => {
    data.set("ipm:3200", JSON.stringify({ var_id: 413, title: "national IPM", sub_name: "IPM", domain: "0000" }));
    const result = await lookupVar("ipm", "3200", store);
    expect(result).toBeNull();
    expect(data.has("ipm:3200")).toBe(false);
  });

  it("accepts a mapping for the same domain", async () => {
    await learnVar("kemiskinan", "3200", {
      var_id: 936,
      title: "Persentase Penduduk Miskin Provinsi Jawa Barat",
      sub_name: "Kemiskinan",
    }, store);
    const result = await lookupVar("kemiskinan", "3200", store);
    expect(result?.var_id).toBe(936);
  });

  it("invalidateVar removes the domain mapping", async () => {
    await learnVar("kemiskinan", "3200", { var_id: 936, title: "x", sub_name: "y" }, store);
    await invalidateVar("kemiskinan", "3200", store);
    expect(await lookupVar("kemiskinan", "3200", store)).toBeNull();
  });
});
