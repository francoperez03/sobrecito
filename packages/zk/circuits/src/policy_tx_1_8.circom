pragma circom 2.2.2;
// Entry Point PolicyTransaction with 1 input, 8 outputs (Sobre payroll batch).
include "./policyTransaction.circom";

// PolicyTransaction(
//   nIns, nOuts,
//   nMembershipProofs, nNonMembershipProofs,
//   levels, smtLevels
// )
component main {public [root, publicAmount, extDataHash, inputNullifier, outputCommitment, membershipRoots, nonMembershipRoots]} = PolicyTransaction(1, 8, 1, 1, 10, 10);
