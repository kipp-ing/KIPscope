# Decision Ledger

Decisions that don't belong to a single OpenSpec change. Newest first. Never edit past entries; supersede them with a new one.

Format: `## D-NNN: Title (YYYY-MM-DD)`, then context, decision, consequences.

## D-003: Commit and push at session end (2026-10-14)

- **Decision:** When the user ends a session, agents commit and push without asking.
- **Why:** No uncommitted work lying around between sessions.

## D-002: Minimal AGENTS.md, decisions in a ledger (2026-10-14)

- **Decision:** AGENTS.md only holds rules and links. Decisions OpenSpec doesn't cover (outside a change's design.md) go here. On archive, project-wide decisions from a change's design.md are copied here too.
- **Why:** Keep agent context small; keep decisions findable in one place.

## D-001: OpenSpec, English artifacts (2026-10-14)

- **Decision:** Development is spec-driven with OpenSpec (schema `spec-driven`). Specs, proposals and code are in English. Claude Code is the configured tool (`/opsx:*` commands); `CLAUDE.md` imports `AGENTS.md`.
- **Why:** Spec-driven workflow chosen by the user; English matches code and tooling.
