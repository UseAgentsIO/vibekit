/** GitHub tool stub. Runtime enforcement is implemented in a later phase. */
export const githubTool = {
  name: "github",
  capabilities: [
    "repository.read",
    "repository.write",
    "repository.issue.read",
    "repository.issue.write",
  ],
};
