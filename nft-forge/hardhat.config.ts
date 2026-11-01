// Hardhat is used only as an in-process EVM for contract tests (tests/contract.test.ts).
// Contracts are compiled by scripts/compile-contracts.ts (solc-js), not by Hardhat.
import { defineConfig } from "hardhat/config";

export default defineConfig({
  networks: {
    default: { type: "edr-simulated", chainType: "generic", hardfork: "cancun", allowUnlimitedContractSize: false },
  },
});
