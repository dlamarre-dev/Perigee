// PreToolUse hook (.claude/settings.json): only the main agent may change the repository's history or GitHub.
// Inside a subagent (Agent tool), the hook input carries `agent_id`; there, git commands that write history or
// talk to the remote, every `gh` command and the GitHub MCP tools that write are refused. Subagents research and
// report; the main agent edits, commits, pushes, opens PRs and comments (docs/maintenance-agent.md).
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
const deny = () => {
  process.stderr.write(
    'Blocked: subagents may not change the repository history, the remote or GitHub (git commit/push…, gh, ' +
      'GitHub write tools). Report your findings to the main agent; it commits, pushes and talks to GitHub.\n',
  );
  process.exit(2);
};
// GitHub MCP tools (cloud sessions: mcp__github__*, mcp__claude-code-remote__*): reads only.
const toolName = String(input.tool_name ?? '');
if (/^mcp__(github|claude-code-remote)__/.test(toolName)) {
  const name = toolName.replace(/^mcp__[^_]+(?:-[^_]+)*__/, '');
  const write =
    /(create|update|add|merge|delete|remove|push|write|trigger|rerun|cancel|request|assign|fork|subscribe|dismiss|close|reopen|lock|star|submit|resolve|label)/;
  const read = /^(get|list|search)_|_(read|get|list)$/;
  if (!read.test(name) && write.test(name)) deny();
  process.exit(0);
}
const command = String(input.tool_input?.command ?? '');
const gitWrite =
  /\bgit\b[^|;&\n]*?\s(commit|push|tag|merge|rebase|reset|cherry-pick|revert|am|pull|fetch|clone|remote|branch\s+-[dDmM]|checkout|switch|stash)\b/;
const gh = /(^|[\s;&|(])gh(\.exe)?\s/;
if (gitWrite.test(command) || gh.test(command)) deny();
process.exit(0);
