import { validateSigning } from "./release-identity.mjs";

export function configureBuild(args, env, project) {
  if (project.updaterEnabled && !project.updaterPublicKey?.trim())
    throw new Error(
      "An updater-enabled build requires its public verification key in project.json.",
    );
  const release = env.CHATPLUS_RELEASE_BUILD === "1";
  if (release) {
    validateSigning(project, env.TAURI_SIGNING_PRIVATE_KEY);
  } else {
    // Ordinary packages never receive signing credentials, even on a maintainer machine.
    delete env.TAURI_SIGNING_PRIVATE_KEY;
    delete env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
  }
  // Apply the build mode after caller overrides, before Cargo's argument separator.
  const delimiter = args.indexOf("--");
  args.splice(
    delimiter < 0 ? args.length : delimiter,
    0,
    "--config",
    JSON.stringify({ bundle: { createUpdaterArtifacts: release } }),
  );
  return release;
}
