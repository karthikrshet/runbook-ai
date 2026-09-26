import { describe, expect, it } from "vitest";
import { calculateBlastRadius } from "../src/domain/blast-radius.js";

describe("Blast Radius Calculator", () => {
  it("read-only action -> LOW risk class", () => {
    const br = calculateBlastRadius({
      id: "act-ro",
      description: "Read metrics",
      category: "READ_ONLY",
      resourcesAffected: 1,
    });
    expect(br.riskClass).toBe("LOW");
    expect(br.resourcesAffected).toBe(1);
  });

  it("sandbox-only action -> LOW risk class", () => {
    const br = calculateBlastRadius({
      id: "act-sb",
      description: "Run unit tests in sandbox",
      category: "SANDBOX_ONLY",
      resourcesAffected: 1,
    });
    expect(br.riskClass).toBe("LOW");
  });

  it("destructive action -> HIGH risk class", () => {
    const br = calculateBlastRadius({
      id: "act-dest",
      description: "Terminate unhealthy instances",
      category: "CONSEQUENTIAL",
      destructive: true,
      resourcesAffected: 2,
    });
    expect(br.riskClass).toBe("HIGH");
    expect(br.destructive).toBe(true);
  });

  it("mutation without rollback -> HIGH risk class", () => {
    const br = calculateBlastRadius({
      id: "act-no-rb",
      description: "Apply one-way data migration",
      category: "CONSEQUENTIAL",
      mutatesData: true,
      rollbackAvailable: false,
      resourcesAffected: 1,
    });
    expect(br.riskClass).toBe("HIGH");
  });

  it(">3 resources affected -> HIGH risk class", () => {
    const br = calculateBlastRadius({
      id: "act-many-res",
      description: "Restart multiple services",
      category: "REVERSIBLE_EXTERNAL",
      mutatesExternalState: true,
      rollbackAvailable: true,
      resourcesAffected: 4,
    });
    expect(br.riskClass).toBe("HIGH");
  });

  it("customer-facing reversible external mutation with rollback -> MEDIUM risk class", () => {
    const br = calculateBlastRadius({
      id: "act-cust-med",
      description: "Switch active-active routing percentage",
      category: "REVERSIBLE_EXTERNAL",
      customerFacing: true,
      mutatesExternalState: true,
      rollbackAvailable: true,
      resourcesAffected: 1,
    });
    expect(br.riskClass).toBe("MEDIUM");
  });

  it("forbidden action -> BLOCKED risk class", () => {
    const br = calculateBlastRadius({
      id: "act-forbid",
      description: "Execute raw shell without validation",
      category: "FORBIDDEN",
    });
    expect(br.riskClass).toBe("BLOCKED");
  });

  it("secret exposure requested -> BLOCKED risk class", () => {
    const br = calculateBlastRadius({
      id: "act-leak-br",
      description: "Dump credentials",
      category: "READ_ONLY",
      requestsSecretExposure: true,
    });
    expect(br.riskClass).toBe("BLOCKED");
  });

  it("unknown scope -> BLOCKED risk class", () => {
    const br = calculateBlastRadius({
      id: "act-unk-br",
      description: "Unknown wildcard operation",
      category: "READ_ONLY",
      unknownScope: true,
    });
    expect(br.riskClass).toBe("BLOCKED");
  });

  it("extracts external systems correctly", () => {
    const br = calculateBlastRadius({
      id: "act-ext",
      description: "Call GitHub API",
      category: "READ_ONLY",
      externalSystem: "github",
    });
    expect(br.externalSystemsTouched).toEqual(["github"]);
  });
});
