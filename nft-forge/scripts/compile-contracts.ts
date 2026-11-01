/**
 * Compiles the Solidity contracts with solc-js and writes committed artifacts:
 *  - src/lib/evm/ForgeCollection.artifact.json: ABI, bytecode, compiler version and
 *    the exact standard-JSON input (reused for Blockscout source verification).
 *  - tests/ForgeCollectionProbe.artifact.json: test harness run via eth_call.
 *
 *   npm run compile:contracts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import solc from "solc";

const root = process.cwd();
// Cancun: required by OpenZeppelin 5.6 (MCOPY); supported by Arbitrum Nitro since ArbOS 20.
// scripts/robinhood-simulate.ts confirms the contract runs on the live Robinhood Chain networks.
const EVM_VERSION = "cancun";
const OPTIMIZER = { enabled: true, runs: 200 };

function compile(sourceName: string, contractName: string) {
  const sources: Record<string, { content: string }> = {
    [sourceName]: { content: readFileSync(path.join(root, sourceName), "utf8") },
  };
  const findImports = (p: string) => {
    const candidates = [path.join(root, "node_modules", p), path.join(root, p)];
    for (const file of candidates) {
      try {
        const content = readFileSync(file, "utf8");
        sources[p] = { content };
        return { contents: content };
      } catch {
        /* try next */
      }
    }
    return { error: `File not found: ${p}` };
  };
  const input = {
    language: "Solidity",
    sources: { [sourceName]: sources[sourceName] },
    settings: {
      optimizer: OPTIMIZER,
      evmVersion: EVM_VERSION,
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
    },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
  for (const e of out.errors ?? []) console.log(`${e.severity.toUpperCase()}: ${e.formattedMessage}`);
  if ((out.errors ?? []).some((e: { severity: string }) => e.severity === "error")) process.exit(1);
  const c = out.contracts[sourceName][contractName];
  return {
    contractName,
    sourceName,
    compiler: `v${solc.version().replace(".Emscripten.clang", "")}`,
    evmVersion: EVM_VERSION,
    optimizerRuns: OPTIMIZER.runs,
    abi: c.abi,
    bytecode: `0x${c.evm.bytecode.object}`,
    deployedBytecode: `0x${c.evm.deployedBytecode.object}`,
    standardJsonInput: {
      language: "Solidity",
      sources,
      settings: { optimizer: OPTIMIZER, evmVersion: EVM_VERSION, outputSelection: { "*": { "*": ["abi", "evm.bytecode", "evm.deployedBytecode", "metadata"] } } },
    },
  };
}

const main = compile("contracts/ForgeCollection.sol", "ForgeCollection");
const { standardJsonInput, ...runtime } = main;
// Kept separate: the browser bundle only needs the ABI and bytecode; the server uses the input for Blockscout verification.
writeFileSync(path.join(root, "src/lib/evm/ForgeCollection.artifact.json"), JSON.stringify(runtime));
writeFileSync(path.join(root, "src/lib/evm/ForgeCollection.verify.json"), JSON.stringify(standardJsonInput));
console.log(`ForgeCollection: ${main.compiler} (${EVM_VERSION}), runtime ${((main.deployedBytecode.length - 2) / 2).toLocaleString()} bytes`);

const probe = compile("contracts/test/ForgeCollectionProbe.sol", "ForgeCollectionProbe");
writeFileSync(path.join(root, "tests/ForgeCollectionProbe.artifact.json"), JSON.stringify({ abi: probe.abi, bytecode: probe.bytecode }));
console.log(`ForgeCollectionProbe: compiled (test harness)`);

const attacker = compile("contracts/test/ReentrantMinter.sol", "ReentrantMinter");
writeFileSync(path.join(root, "tests/ReentrantMinter.artifact.json"), JSON.stringify({ abi: attacker.abi, bytecode: attacker.bytecode }));
console.log(`ReentrantMinter: compiled (test harness)`);
