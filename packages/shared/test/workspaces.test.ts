import { describe, expect, it } from "vitest";
import {
  CLOSE_NO_ACCESS,
  CLOSE_WORKSPACE_GONE,
  CreateWorkspaceRequest,
  GRANT_ALL,
  GRANT_NONE,
  Grant,
  LOCAL_USER,
  MAX_GRANT_OBJECTS,
  MAX_WORKSPACES_PER_USER,
  OpenViewRequest,
  parseWorkspaceLink,
  RECENT_WORKSPACES,
  ShareRequest,
  USER_ID,
  WORKSPACE_HEADER,
  WORKSPACE_ID,
  WorkspaceShare,
  workspaceApi,
  workspacePath,
} from "../src/workspaces.ts";

describe("workspace DTOs (add-multiuser M3, M7)", () => {
  it("parses workspace links", () => {
    // The page, the API prefix and the legacy UI path all give origin and ID.
    expect(parseWorkspaceLink("https://k.example/w/abcdefghij")).toEqual({
      origin: "https://k.example",
      workspace: "abcdefghij",
    });
    expect(parseWorkspaceLink("https://k.example/api/w/abcdefghij/live")).toEqual({
      origin: "https://k.example",
      workspace: "abcdefghij",
    });
    expect(parseWorkspaceLink("https://k.example/s/abcdefghij")).toEqual({
      origin: "https://k.example",
      workspace: "abcdefghij",
    });
    // The origin keeps a non-default port and the scheme.
    expect(parseWorkspaceLink("http://127.0.0.1:7310/w/0123456789")).toEqual({
      origin: "http://127.0.0.1:7310",
      workspace: "0123456789",
    });
    // Not a workspace address: another path, a wrong ID, a wrong length, the old API prefix,
    // no URL at all.
    for (const bad of [
      "https://k.example/x",
      "https://k.example/w/ABC",
      "https://k.example/w/ABCDEFGHIJ",
      "https://k.example/w/abcdefghi",
      "https://k.example/w/abcdefghijk",
      "https://k.example/api/s/abcdefghij/live",
      "https://k.example/",
      "abcdefghij",
      "not a url",
      "",
    ]) {
      expect(parseWorkspaceLink(bad), bad).toBeUndefined();
    }
  });

  it("builds the page and API paths of a workspace", () => {
    expect(workspacePath("abcdefghij")).toBe("/w/abcdefghij");
    expect(workspaceApi("abcdefghij")).toBe("/api/w/abcdefghij");
    // What the builders produce, the parser reads back.
    const link = `https://k.example${workspacePath("abcdefghij")}`;
    expect(parseWorkspaceLink(link)?.workspace).toBe("abcdefghij");
    expect(
      parseWorkspaceLink(`https://k.example${workspaceApi("abcdefghij")}/workspace`)?.workspace,
    ).toBe("abcdefghij");
  });

  it("pins the constants of the contract", () => {
    expect(LOCAL_USER).toBe("local");
    expect(MAX_WORKSPACES_PER_USER).toBe(200);
    expect(WORKSPACE_HEADER).toBe("x-kipscope-workspace");
    expect(RECENT_WORKSPACES).toBe(10);
    expect(CLOSE_NO_ACCESS).toBe(4403);
    expect(CLOSE_WORKSPACE_GONE).toBe(4404);
    expect(MAX_GRANT_OBJECTS).toBe(2000);
    expect(GRANT_ALL).toEqual({ objects: "all" });
    expect(GRANT_NONE).toEqual({ objects: [] });
  });

  it("accepts workspace IDs of 10 lower-case letters and digits only", () => {
    for (const ok of ["abcdefghij", "0123456789", "a1b2c3d4e5"]) {
      expect(WORKSPACE_ID.test(ok), ok).toBe(true);
    }
    for (const bad of ["ABCDEFGHIJ", "abcdefghi", "abcdefghijk", "abcdefghi-", "abcdefghi_", ""]) {
      expect(WORKSPACE_ID.test(bad), bad).toBe(false);
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
    expect(WorkspaceShare.safeParse("private").success).toBe(true);
    expect(WorkspaceShare.safeParse("read").success).toBe(true);
    expect(WorkspaceShare.safeParse("write").success).toBe(true);
    expect(WorkspaceShare.safeParse("public").success).toBe(false);

    expect(ShareRequest.safeParse({ share: "read" }).success).toBe(true);
    expect(ShareRequest.safeParse({ share: "public" }).success).toBe(false);
    expect(ShareRequest.safeParse({ share: "read", extra: 1 }).success).toBe(false);
    expect(ShareRequest.safeParse({}).success).toBe(false);

    expect(CreateWorkspaceRequest.safeParse({}).success).toBe(true);
    expect(CreateWorkspaceRequest.safeParse({ open: { name: "speeds" } }).success).toBe(true);
    expect(CreateWorkspaceRequest.safeParse({ open: { view: { kipscope: "view" } } }).success).toBe(
      true,
    );
    expect(CreateWorkspaceRequest.safeParse({ reuse: true }).success).toBe(true);
    expect(CreateWorkspaceRequest.safeParse({ reuse: false }).success).toBe(false);
    expect(CreateWorkspaceRequest.safeParse({ open: { name: 3 } }).success).toBe(false);
    expect(CreateWorkspaceRequest.safeParse({ owner: "mallory" }).success).toBe(false);
    // A client never sets a grant (data-access "A client cannot set a grant").
    expect(CreateWorkspaceRequest.safeParse({ grant: { objects: "all" } }).success).toBe(false);

    expect(OpenViewRequest.safeParse({ name: "x" }).success).toBe(true);
    expect(OpenViewRequest.safeParse({ view: { a: 1 } }).success).toBe(true);
    expect(OpenViewRequest.safeParse({}).success).toBe(false);
  });

  it("checks a grant strictly", () => {
    expect(Grant.safeParse({ objects: "all" }).success).toBe(true);
    expect(Grant.safeParse({ objects: [] }).success).toBe(true);
    expect(Grant.safeParse({ objects: ["testcar", "demo"] }).success).toBe(true);
    // Unknown key, a string other than "all", a non-string object, a duplicate, a bad data ref.
    expect(Grant.safeParse({ objects: "all", extra: 1 }).success).toBe(false);
    expect(Grant.safeParse({ objects: "some" }).success).toBe(false);
    expect(Grant.safeParse({ objects: [1] }).success).toBe(false);
    expect(Grant.safeParse({ objects: ["a", "a"] }).success).toBe(false);
    expect(Grant.safeParse({ objects: [""] }).success).toBe(false);
    expect(Grant.safeParse({}).success).toBe(false);
    expect(Grant.safeParse("all").success).toBe(false);
    // The size limit: 2,000 objects pass, 2,001 do not.
    const refs = (n: number) => Array.from({ length: n }, (_, i) => `car${i}`);
    expect(Grant.safeParse({ objects: refs(MAX_GRANT_OBJECTS) }).success).toBe(true);
    expect(Grant.safeParse({ objects: refs(MAX_GRANT_OBJECTS + 1) }).success).toBe(false);
  });
});
