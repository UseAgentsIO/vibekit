import {
  evaluateVerification,
  recordIndependentReview,
  runCommandVerification,
  type IndependentReviewInput,
  type RunCommandVerificationInput,
} from "@useagentsio/core";

/** Persist command Verification for a completed Run Result. Does not start Pi. */
export function verifyAfterRun(input: RunCommandVerificationInput) {
  return runCommandVerification(input);
}

/** Persist an independent review contract. The producing Agent cannot review itself. */
export function reviewAfterRun(input: IndependentReviewInput) {
  return recordIndependentReview(input);
}

export { evaluateVerification };
