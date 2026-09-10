import { describe, expect, it } from "vitest";
import { classifyInboundSmsBody } from "../src/services/sms-keyword-classifier.js";

describe("classifyInboundSmsBody", () => {
  describe("opt-out", () => {
    it.each(["STOP", "UNSUBSCRIBE", "END", "QUIT", "STOPALL", "REVOKE", "OPTOUT", "CANCEL"])(
      "classifies %s as opt_out",
      (keyword) => {
        expect(classifyInboundSmsBody(keyword)).toBe("opt_out");
      },
    );

    it("is case-insensitive", () => {
      expect(classifyInboundSmsBody("stop")).toBe("opt_out");
      expect(classifyInboundSmsBody("Stop")).toBe("opt_out");
      expect(classifyInboundSmsBody("sToP")).toBe("opt_out");
    });

    it("tolerates leading/trailing whitespace", () => {
      expect(classifyInboundSmsBody("  STOP  ")).toBe("opt_out");
      expect(classifyInboundSmsBody("\tSTOP\n")).toBe("opt_out");
    });

    it("rejects 'STOP PLEASE' -- exact match only, no substring matching", () => {
      expect(classifyInboundSmsBody("STOP PLEASE")).toBe("unknown");
    });

    it("rejects 'PLEASE STOP' -- exact match only, no substring matching", () => {
      expect(classifyInboundSmsBody("PLEASE STOP")).toBe("unknown");
    });

    it("rejects unrelated text", () => {
      expect(classifyInboundSmsBody("what time is my appointment")).toBe("unknown");
    });
  });

  describe("opt-in", () => {
    it.each(["START", "UNSTOP"])("classifies %s as opt_in", (keyword) => {
      expect(classifyInboundSmsBody(keyword)).toBe("opt_in");
    });

    it("is case-insensitive", () => {
      expect(classifyInboundSmsBody("start")).toBe("opt_in");
      expect(classifyInboundSmsBody("UnStop")).toBe("opt_in");
    });

    it("tolerates leading/trailing whitespace", () => {
      expect(classifyInboundSmsBody("  START  ")).toBe("opt_in");
    });

    it("does NOT classify YES as opt-in -- deliberately excluded per the approved architecture", () => {
      expect(classifyInboundSmsBody("YES")).toBe("unknown");
      expect(classifyInboundSmsBody("yes")).toBe("unknown");
    });
  });

  describe("help", () => {
    it("classifies HELP", () => {
      expect(classifyInboundSmsBody("HELP")).toBe("help");
    });

    it("is case-insensitive", () => {
      expect(classifyInboundSmsBody("help")).toBe("help");
      expect(classifyInboundSmsBody("Help")).toBe("help");
    });

    it("tolerates leading/trailing whitespace", () => {
      expect(classifyInboundSmsBody("  HELP  ")).toBe("help");
    });
  });

  describe("unknown", () => {
    it("classifies empty string as unknown", () => {
      expect(classifyInboundSmsBody("")).toBe("unknown");
    });

    it("classifies arbitrary text as unknown", () => {
      expect(classifyInboundSmsBody("Thanks, see you then!")).toBe("unknown");
    });
  });
});
