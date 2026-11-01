"use client";

import { useProject } from "@/components/project-context";
import { RobinhoodDeploy } from "./robinhood";
import { SolanaDeploy } from "./solana";

/** Deployment Studio: Robinhood Chain (default target) or Solana, per the project's chain. */
export default function DeployPage() {
  const { project } = useProject();
  return project.chain === "solana" ? <SolanaDeploy /> : <RobinhoodDeploy />;
}
