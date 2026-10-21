/**
 * Guide: Give a Vercel AI SDK Agent a Paid-Fetch Tool — compiled in CI (SPEC.md section 13.2).
 */

import { createHaggles, readReceipt } from "@haggles/client";
import { tool } from "ai";
import { z } from "zod";

const haggles = createHaggles({
  agentKey: process.env.HAGGLES_KEY!,
  maxPricePerCall: "0.10",
});

export const buySourceTool = tool({
  description:
    "Fetches a paid HTTP 402 data endpoint using the agent's Haggles spending policy and returns the JSON payload plus the settled price.",
  parameters: z.object({
    url: z.string().url().describe("HTTPS URL of the Haggles-enabled endpoint"),
  }),
  execute: async ({ url }) => {
    const response = await haggles.fetch(url);
    const receipt = readReceipt(response);
    const payload: unknown = await response.json();
    return {
      pricePaidUsd: receipt?.amount ?? "0.00",
      paymentId: receipt?.paymentId ?? null,
      payload,
    };
  },
});
