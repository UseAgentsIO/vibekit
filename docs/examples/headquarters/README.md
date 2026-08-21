# Headquarters — Chief + Personal life coordinator

A maintained example **Project** (not a decorative README). You talk to **Chief**; Chief delegates personal work to **Personal**. Interfaces: Telegram and Terminal. Optional Components in this tree: memory, scheduler, web.

This directory is the canonical fixture. Tests copy it and run `doctor` against the official registry. `vibekit create --example headquarters` is the smaller getting-started scaffold (Chief + Personal + Telegram). Do not use `vibekit add headquarters`.

---

## Create it

When the consolidated product is published:

```bash
npm install --global --ignore-scripts @useagentsio/vibekit@latest
vibekit create ~/headquarters --example headquarters --provider openai --yes
cd ~/headquarters
```

`@useagentsio/vibekit` is not published yet. Use the local product tarball flow in the [contributor guide](../../contributing/guide.md#local-product-tarball) when validating this checked-in fixture.

From this repository:

```bash
pnpm exec tsx packages/cli/src/index.ts create ~/headquarters --example headquarters --provider openai --yes --registry registry
cd ~/headquarters
```

The `headquarters` preset expands Chief's delegation graph, so it installs Chief, Personal, Project Manager, Coder, Reviewer, and Researcher together with `provider:openai`, `interface:telegram`, the pairing and inbound policies, the required research and software-development Skills, repository State, built-in file and command abilities, and the command Verifier.

Interactive create (no `--yes`) prompts for missing **required secrets** declared on those modules (`OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN`). Values go to `~/.config/vibekit/<project>/env`, never YAML.

On first launch, `vibekit start` will prompt for your credentials and save them securely in your local deployment store (`~/.config/vibekit/<project>/env` with `0600` permissions), or you can provide them in your environment:

```bash
export OPENAI_API_KEY="sk-proj-..."
export TELEGRAM_BOT_TOKEN="123456789:AA..."
```

Telegram token: message `@BotFather` → `/newbot`.

---

## Run it

```bash
vibekit start
```

VibeKit runs as a background service so Telegram can poll.

1. Message the bot. It replies with an **8-character** pairing code (expires in 1 hour).
2. In your terminal:

   ```bash
   vibekit approve-pairing <code>
   ```

3. Message again. Chief answers and can delegate to Personal.

Optional: put your Telegram user id in `.vibekit/config/interfaces/telegram-main.yaml` as `allowFrom: ["123456789"]` to skip pairing.

---

## Talk to Chief

> Plan Saturday around a 2pm dentist visit. Leave time for a workout and groceries.

Chief should assign a Task to Personal and return the plan.

---

## Add another Agent later

The preset already includes Researcher because Chief's delegation graph names it. To add an Agent that is not part of that graph, for example the general-purpose Assistant:

```bash
vibekit add agent assistant --yes
```

Then add `assistant` under `delegation.chief` in `.vibekit/project.yaml` if Chief should hand work there.

---

## Stop

```bash
vibekit stop
```
