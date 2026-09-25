# CLAUDE.md

This file gives Claude Code guidance for working in this repository.

The project's agent instructions live in the OpenCode config and are the single source of truth. Follow them as if they were written here:

@.opencode/instructions.md

## Related OpenCode resources

- `.opencode/sdlc.md`: the mandatory six-stage SDLC workflow, referenced from the instructions above.
- `.opencode/opencode.json`: role prompts for the SDLC sub-agents (orchestrator, requirements elicitation, exploration, PRD validation, implementation review, code reviewer). Read the matching prompt when acting in one of these roles.
- `.opencode/skills/`: skills the SDLC stages rely on, such as `requirements-elicitation` and `prd-review`. Read the relevant `SKILL.md` when a stage calls for one.

Keep project-specific guidance in `.opencode/instructions.md`, not in this file, so both tools stay in sync.
