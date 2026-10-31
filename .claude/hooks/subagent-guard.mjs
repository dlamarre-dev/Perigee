// PreToolUse hook (.claude/settings.json): only the main agent may change the repository's history or GitHub.
// Inside a subagent (Agent tool), the hook input carries `agent_id`; there, git commands that write history or
// talk to the remote, and every `gh` command, are refused. Subagents research and report; the main agent edits,
// commits, pushes, opens PRs and comments (docs/maintenance-agent.md).
import process from 'node:process';

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
let input;
try {
  input = JSON.parse(raw);
} catch {
  process.exit(0);
}
if (!input?.agent_id) process.exit(0);
const command = String(input.tool_input?.command ?? '');
const gitWrite =
  /\bgit\b[^|;&\n]*?\s(commit|push|tag|merge|rebase|reset|cherry-pick|revert|am|pull|fetch|clone|remote|branch\s+-[dDmM]|checkout|switch|stash)\b/;
const gh = /(^|[\s;&|(])gh(\.exe)?\s/;
if (gitWrite.test(command) || gh.test(command)) {
  process.stderr.write(
    'Blocked: subagents may not run git commands that change history or the remote, nor gh. ' +
      'Report your findings to the main agent; it commits, pushes and talks to GitHub.\n',
  );
  process.exit(2);
}
process.exit(0);
