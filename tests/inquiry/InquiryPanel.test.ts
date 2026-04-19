// @vitest-environment jsdom

// Tests for InquiryPanel.bannerForDiscoverError — the static mapping that
// turns SidecarClient.discover() rejections (Task 14 in the security-hardening
// plan) into user-facing banner strings (Task 17).
//
// We deliberately exercise the static helper rather than the full panel so the
// tests stay free of DOM/Logseq-host dependencies. The helper owns all the
// branching logic; init() just hands off to it and calls logseq.UI.showMsg.

import { describe, it, expect, vi } from "vitest";

// Stub the inline-CSS import so the InquiryPanel module loads under vitest
// (Vite resolves `?inline` at build time; vitest needs a manual stub.)
vi.mock("../../src/styles/archivist-inquiry.css?inline", () => ({
  default: "",
}));

import { InquiryPanel } from "@/inquiry/InquiryPanel";

describe("InquiryPanel.bannerForDiscoverError", () => {
  it("maps the 'not running' error to the start-bridge banner", () => {
    const err = new Error(
      "archivist-bridge is not running — start it from the plugin settings.",
    );
    expect(InquiryPanel.bannerForDiscoverError(err)).toBe(
      "The archivist-bridge is not running. Start it from the plugin settings.",
    );
  });

  it("maps the 'out of date' error to the update banner", () => {
    const err = new Error("archivist-bridge is out of date — please update.");
    expect(InquiryPanel.bannerForDiscoverError(err)).toBe(
      "The archivist-bridge is out of date. Please update.",
    );
  });

  it("maps the 'corrupted' error to the restart-bridge banner", () => {
    const err = new Error(
      "archivist-bridge server.json is corrupted — restart the bridge.",
    );
    expect(InquiryPanel.bannerForDiscoverError(err)).toBe(
      "The archivist-bridge isn't responding. Restart it from the plugin settings.",
    );
  });

  it("maps the 'malformed' error to the restart-bridge banner", () => {
    const err = new Error(
      "archivist-bridge server.json is malformed (no port).",
    );
    expect(InquiryPanel.bannerForDiscoverError(err)).toBe(
      "The archivist-bridge isn't responding. Restart it from the plugin settings.",
    );
  });

  it("falls back to a generic prefix for unknown errors", () => {
    const err = new Error("EHOSTUNREACH 127.0.0.1");
    expect(InquiryPanel.bannerForDiscoverError(err)).toBe(
      "Archivist connection error: EHOSTUNREACH 127.0.0.1",
    );
  });

  it("handles non-Error rejections (string)", () => {
    expect(InquiryPanel.bannerForDiscoverError("boom")).toBe(
      "Archivist connection error: boom",
    );
  });

  it("handles null/undefined rejections without throwing", () => {
    expect(InquiryPanel.bannerForDiscoverError(null)).toBe(
      "Archivist connection error: null",
    );
    expect(InquiryPanel.bannerForDiscoverError(undefined)).toBe(
      "Archivist connection error: undefined",
    );
  });
});
