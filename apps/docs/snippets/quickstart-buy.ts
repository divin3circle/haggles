/**
 * 5-minute Buyer Quickstart (`@haggles/client`) — compiled in CI (SPEC.md section 13.2).
 */

import { createHaggles, readReceipt, type HagglesPaymentEvent } from "@haggles/client";

export async function runBuyerQuickstart(): Promise<void> {
  const haggles = createHaggles({
    agentKey: process.env.HAGGLES_KEY!,
    maxPricePerCall: "0.10",
    onPayment: (event: HagglesPaymentEvent) => {
      console.log(`Paid $${event.amount} to ${event.sellerId} (${event.paymentId})`);
    },
  });

  const response = await haggles.fetch(
    "https://datasets.example.com/datasets/rent-index?city=austin",
  );
  const receipt = readReceipt(response);
  const data: unknown = await response.json();

  console.log("Receipt:", receipt?.paymentId, "Data:", data);
}
