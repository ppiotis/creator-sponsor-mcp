/**
 * Payout providers. This server NEVER moves money. Providers only record that a payment was made
 * elsewhere (a ledger entry) or explain why they are unavailable.
 */
import { UserError } from "./result.js";
export const manualLedger = {
    id: "manual",
    name: "Manual ledger",
    available: true,
    description: "Pay the creator yourself (X Money, bank transfer, PayPal, etc.), then record the payment here with its transaction reference. Nothing is sent by this server.",
    validate(_deal, input) {
        if (!input.reference?.trim())
            throw new UserError("The manual ledger needs a `reference` (e.g. the X Money or bank transaction id) proving the payment was made.");
    },
};
export const xMoneyStub = {
    id: "x_money",
    name: "X Money (pending a public payouts API)",
    available: false,
    description: "Placeholder adapter. X Money has no public payouts API for third-party apps, so this provider cannot pay or verify payments. Pay in the X Money app and record it with provider `manual` and the X Money transaction reference.",
    validate() {
        throw new UserError("X Money payouts are not available: there is no public X Money payouts API yet. Pay the creator in X Money yourself, then call record_payout with provider \"manual\" and the X Money transaction reference.");
    },
};
export const PROVIDERS = { [manualLedger.id]: manualLedger, [xMoneyStub.id]: xMoneyStub };
export function getProvider(id) {
    const p = PROVIDERS[id];
    if (!p)
        throw new UserError(`Unknown payout provider "${id}". Available: ${Object.keys(PROVIDERS).join(", ")}`);
    return p;
}
