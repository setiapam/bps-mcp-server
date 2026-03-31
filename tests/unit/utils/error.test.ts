import { describe, it, expect } from "vitest";
import {
  BpsApiError,
  BpsNotFoundError,
  BpsAuthError,
  formatErrorForUser,
} from "../../../src/utils/error.js";

describe("BpsApiError", () => {
  it("should create error with message only", () => {
    const err = new BpsApiError("something failed");
    expect(err.message).toBe("something failed");
    expect(err.name).toBe("BpsApiError");
    expect(err.statusCode).toBeUndefined();
    expect(err.endpoint).toBeUndefined();
    expect(err).toBeInstanceOf(Error);
  });

  it("should create error with status code and endpoint", () => {
    const err = new BpsApiError("timeout", 504, "/api/v1/data");
    expect(err.statusCode).toBe(504);
    expect(err.endpoint).toBe("/api/v1/data");
  });

  it("should be instanceof Error", () => {
    const err = new BpsApiError("test");
    expect(err instanceof Error).toBe(true);
    expect(err instanceof BpsApiError).toBe(true);
  });
});

describe("BpsNotFoundError", () => {
  it("should create 404 error with Indonesian message", () => {
    const err = new BpsNotFoundError("Tabel Statis #123");
    expect(err.message).toBe("Data tidak ditemukan: Tabel Statis #123");
    expect(err.name).toBe("BpsNotFoundError");
    expect(err.statusCode).toBe(404);
  });

  it("should be instanceof BpsApiError", () => {
    const err = new BpsNotFoundError("test");
    expect(err instanceof BpsApiError).toBe(true);
    expect(err instanceof BpsNotFoundError).toBe(true);
  });
});

describe("BpsAuthError", () => {
  it("should create 401 error with Indonesian message", () => {
    const err = new BpsAuthError();
    expect(err.message).toBe("Autentikasi gagal. Periksa BPS_API_KEY Anda.");
    expect(err.name).toBe("BpsAuthError");
    expect(err.statusCode).toBe(401);
  });

  it("should be instanceof BpsApiError", () => {
    const err = new BpsAuthError();
    expect(err instanceof BpsApiError).toBe(true);
  });
});

describe("formatErrorForUser", () => {
  it("should format BpsAuthError with help text", () => {
    const result = formatErrorForUser(new BpsAuthError());
    expect(result).toContain("Autentikasi gagal");
    expect(result).toContain("webapi.bps.go.id");
  });

  it("should format BpsNotFoundError", () => {
    const result = formatErrorForUser(new BpsNotFoundError("variabel X"));
    expect(result).toBe("Data tidak ditemukan: variabel X");
  });

  it("should format generic BpsApiError with status code", () => {
    const result = formatErrorForUser(new BpsApiError("rate limited", 429));
    expect(result).toContain("Error dari BPS API (429)");
    expect(result).toContain("rate limited");
  });

  it("should format BpsApiError without status code", () => {
    const result = formatErrorForUser(new BpsApiError("network error"));
    expect(result).toContain("Error dari BPS API (unknown)");
    expect(result).toContain("network error");
  });

  it("should format generic Error", () => {
    const result = formatErrorForUser(new Error("random failure"));
    expect(result).toContain("Terjadi kesalahan");
    expect(result).toContain("random failure");
  });

  it("should format unknown error type", () => {
    const result = formatErrorForUser("string error");
    expect(result).toBe("Terjadi kesalahan yang tidak diketahui.");
  });

  it("should format null/undefined", () => {
    expect(formatErrorForUser(null)).toBe("Terjadi kesalahan yang tidak diketahui.");
    expect(formatErrorForUser(undefined)).toBe("Terjadi kesalahan yang tidak diketahui.");
  });

  it("should prioritize BpsAuthError over BpsApiError", () => {
    const authErr = new BpsAuthError();
    const result = formatErrorForUser(authErr);
    expect(result).toContain("Autentikasi gagal");
    expect(result).not.toContain("Error dari BPS API");
  });
});
