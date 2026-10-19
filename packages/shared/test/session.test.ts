import { describe, expect, it } from "vitest";
import {
  CLOSE_NO_ACCESS,
  CLOSE_SESSION_GONE,
  CreateSessionRequest,
  LOCAL_USER,
  MAX_SESSIONS_PER_USER,
  OpenViewRequest,
  parseSessionLink,
  SESSION_HEADER,
  SESSION_ID,
  SessionShare,
  ShareRequest,
  sessionApi,
  sessionPath,
  USER_ID,
} from "../src/session.ts";

describe("session DTOs (add-multiuser M7)", () => {
  it("parses session links", () => {
    expect(parseSessionLink("https://k.example/s/abcdefghij")).toEqual({
      origin: "https://k.example",
      session: "abcdefghij",
    });
    expect(parseSessionLink("https://k.example/api/s/abcdefghij/live")).toEqual({
      origin: "https://k.example",
      session: "abcdefghij",
    });
    // The origin keeps a non-default port and the scheme.
    expect(parseSessionLink("http://127.0.0.1:7310/s/0123456789")).toEqual({
      origin: "http://127.0.0.1:7310",
      session: "0123456789",
    });
    // Not a session address: another path, a wrong ID, a wrong length, no URL at all.
    for (const bad of [
      "https://k.example/x",
      "https://k.example/s/ABC",
      "https://k.example/s/ABCDEFGHIJ",
      "https://k.example/s/abcdefghi",
      "https://k.example/s/abcdefghijk",
      "https://k.example/",
      "abcdefghij",
      "not a url",
      "",
    ]) {
      expect(parseSessionLink(bad), bad).toBeUndefined();
    }
  });

  it("builds the page and API paths of a session", () => {
    expect(sessionPath("abcdefghij")).toBe("/s/abcdefghij");
    expect(sessionApi("abcdefghij")).toBe("/api/s/abcdefghij");
    // What the builders produce, the parser reads back.
    const link = `https://k.example${sessionPath("abcdefghij")}`;
    expect(parseSessionLink(link)?.session).toBe("abcdefghij");
    expect(
      parseSessionLink(`https://k.example${sessionApi("abcdefghij")}/workspace`)?.session,
    ).toBe("abcdefghij");
  });

  it("pins the constants of the contract", () => {
    expect(LOCAL_USER).toBe("local");
    expect(MAX_SESSIONS_PER_USER).toBe(200);
    expect(SESSION_HEADER).toBe("x-kipscope-session");
    expect(CLOSE_NO_ACCESS).toBe(4403);
    expect(CLOSE_SESSION_GONE).toBe(4404);
  });

  it("accepts session IDs of 10 lower-case letters and digits only", () => {
    for (const ok of ["abcdefghij", "0123456789", "a1b2c3d4e5"]) {
      expect(SESSION_ID.test(ok), ok).toBe(true);
    }
    for (const bad of ["ABCDEFGHIJ", "abcdefghi", "abcdefghijk", "abcdefghi-", "abcdefghi_", ""]) {
      expect(SESSION_ID.test(bad), bad).toBe(false);
    }
  });

  it("accepts user IDs that are safe as a folder name", () => {
    for (const ok of ["local", "alice", "a", "alice.smith@corp", "Bob_2-x", "A".repeat(64)]) {
      expect(USER_ID.test(ok), ok).toBe(true);
    }
    // Path tricks, a leading dot or dash, spaces, slashes, control characters, 65 characters.
    for (const bad of [
      "../x",
      "..",
      ".hidden",
      "-x",
      "a b",
      "a/b",
      "a\\b",
      "a\nb",
      "",
      "A".repeat(65),
    ]) {
      expect(USER_ID.test(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("checks the request bodies", () => {
    expect(SessionShare.safeParse("private").success).toBe(true);
    expect(SessionShare.safeParse("read").success).toBe(true);
    expect(SessionShare.safeParse("write").success).toBe(true);
    expect(SessionShare.safeParse("public").success).toBe(false);

    expect(ShareRequest.safeParse({ share: "read" }).success).toBe(true);
    expect(ShareRequest.safeParse({ share: "public" }).success).toBe(false);
    expect(ShareRequest.safeParse({ share: "read", extra: 1 }).success).toBe(false);
    expect(ShareRequest.safeParse({}).success).toBe(false);

    expect(CreateSessionRequest.safeParse({}).success).toBe(true);
    expect(CreateSessionRequest.safeParse({ open: { name: "speeds" } }).success).toBe(true);
    expect(CreateSessionRequest.safeParse({ open: { view: { kipscope: "view" } } }).success).toBe(
      true,
    );
    expect(CreateSessionRequest.safeParse({ open: { name: 3 } }).success).toBe(false);
    expect(CreateSessionRequest.safeParse({ owner: "mallory" }).success).toBe(false);

    expect(OpenViewRequest.safeParse({ name: "x" }).success).toBe(true);
    expect(OpenViewRequest.safeParse({ view: { a: 1 } }).success).toBe(true);
    expect(OpenViewRequest.safeParse({}).success).toBe(false);
  });
});
