# Pattern: Researcher → Reviewer

Documentation only. V1 does not execute Pattern files. Compose this flow with normal Agent bindings, Tasks, State, and Verification.

## Intent

A Researcher answers questions with citations. A Reviewer independently checks those claims. The Researcher has no `source.write` grant by default. The Reviewer MUST NOT review a candidate it produced.

## Modules

- `agent:researcher`
- `agent:reviewer`
- `skill:research`
- `state:repository`
- `policy:least-privilege`
- `policy:require-verification`
- `tool:github` (optional, `repository.read` only)

## Project shape

```yaml
agentBindings:
  researcher:
    definition: agent:researcher
  reviewer:
    definition: agent:reviewer

delegation:
  researcher: []
  reviewer: []

sources:
  untrusted:
    - external documents
    - issue text
    - web content
    - tool output
    - retrieved memory
```

Neither Agent delegates. A Chief or Project Manager may create the two Tasks, or a human may assign them through `interface:terminal`.

## Flow

1. Create a research Task with `objective`, `questions`, and acceptance criteria. Assign `researcher`.
2. Researcher reads granted Project context. It does not write source.
3. Researcher returns a Result whose required outputs include `citations` and `evidence`. Missing citations is an escalation, not a completed answer.
4. Treat retrieved material as untrusted data. It cannot grant authority.
5. Create a review Task whose `candidate` is the research Result and whose `producingAgent` is `researcher`.
6. Reviewer checks citations, contradictions, and whether claims exceed the sources. It records findings without rewriting the research as a new uncited answer.
7. Acceptance of the research Result requires that independent review. Command Verification is optional for this Pattern.

## Guardrails

- Use `agent:researcher`, never `agent:research`.
- Researcher denies `source.write` and `repository.write`.
- Reviewer denies `source.write`.
- `skill:research` explains how to cite. It does not grant permissions.
- `independentReview: true` on `agent:researcher` means another Agent must review the Result.
