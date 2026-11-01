import Anthropic from "@anthropic-ai/sdk";
import { body, route } from "@/lib/api";
import { categoriesFromBlueprint, generateBlueprint, hasClaudeCredentials } from "@/lib/architect";
import { getProject, HttpError, updateProject } from "@/lib/store";

export const GET = route(async () => ({ claudeAvailable: hasClaudeCredentials() }));

/** action "generate": create a blueprint. action "apply": scaffold trait categories from it. */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const b = await body<{ action: "generate" | "apply"; provider?: string }>(req);
  const project = await getProject(id);
  if (b.action === "apply") {
    if (!project.blueprint) throw new HttpError(400, "Generate a blueprint first");
    if (project.config.categories.length)
      throw new HttpError(409, "Trait categories already exist. Remove them in the Trait Engine first.");
    return updateProject(id, (p) => void (p.config.categories = categoriesFromBlueprint(p.blueprint!)));
  }
  if (project.artBibleLocked) throw new HttpError(409, "The art bible is locked. Unlock it to regenerate.");
  let blueprint;
  try {
    blueprint = await generateBlueprint(project, b.provider);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError)
      throw new HttpError(401, "Anthropic credentials were rejected. Check ANTHROPIC_API_KEY.");
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, "Rate limited by the AI provider. Try again shortly.");
    if (e instanceof Anthropic.APIError) throw new HttpError(502, `AI provider error: ${e.message}`);
    throw e;
  }
  return updateProject(id, (p) => void (p.blueprint = blueprint));
});
