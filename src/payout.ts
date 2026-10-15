/**
 * Payout providers. This server NEVER moves money. Providers only record that a payment was made
 * elsewhere (a ledger entry) or explain why they are unavailable.
 */
import { UserError } from "./result.js";
import type { Deal } from "./store.js";

export interface PayoutProvider {
  id: string;
  name: string;
  available: boolean;
  description: string;
  /** Validate a payout record before it is written. Throws UserError if not possible. */
  validate(deal: Deal, input: { reference?: string }): void;
}

export const manualLedger: PayoutProvider = {
  id: "manual",
  name: "Manual ledger",
  available: true,
  description: "Pay the creator yourself (X Money, bank transfer, PayPal, etc.), then record the payment here with its transaction reference. Nothing is sent by this server.",
  validate(_deal, input) {
    if (!input.reference?.trim()) throw new UserError("The manual ledger needs a `reference` (e.g. the X Money or bank transaction id) proving the payment was made.");
  },
};

export const xMoneyStub: PayoutProvider = {
  id: "x_money",
  name: "X Money (pending a public payouts API)",
  available: false,
  description: "Placeholder adapter. X Money has no public payouts API for third-party apps, so this provider cannot pay or verify payments. Pay in the X Money app and record it with provider `manual` and the X Money transaction reference.",
  validate() {
    throw new UserError("X Money payouts are not available: there is no public X Money payouts API yet. Pay the creator in X Money yourself, then call record_payout with provider \"manual\" and the X Money transaction reference.");
  },
};

export const PROVIDERS: Record<string, PayoutProvider> = { [manualLedger.id]: manualLedger, [xMoneyStub.id]: xMoneyStub };

export function getProvider(id: string): PayoutProvider {
  const p = PROVIDERS[id];
  if (!p) throw new UserError(`Unknown payout provider "${id}". Available: ${Object.keys(PROVIDERS).join(", ")}`);
  return p;
}
