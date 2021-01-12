export enum DepositStatus {
  START,

  // FUNDING FLOW
  AWAITING_SIGNER_SETUP,
  AWAITING_BTC_FUNDING_PROOF,

  // FAILED SETUP
  FAILED_SETUP,

  // ACTIVE
  ACTIVE, // includes courtesy call

  // REDEMPTION FLOW
  AWAITING_WITHDRAWAL_SIGNATURE,
  AWAITING_WITHDRAWAL_PROOF,
  REDEEMED,

  // SIGNER LIQUIDATION FLOW
  COURTESY_CALL,
  FRAUD_LIQUIDATION_IN_PROGRESS,
  LIQUIDATION_IN_PROGRESS,
  LIQUIDATED,

  // KEEPER-SPECIFIC
  KEEPER_REDEEMING,
  KEEPER_REDEEMED,
}
