# Headquarters — Chief + Personal life coordinator

A maintained example **Project** (not a decorative README). You talk to **Chief**; Chief delegates personal work to **Personal**. Interfaces: Telegram and Terminal. Optional Components in this tree: memory, scheduler, web.

This directory is the canonical fixture. Tests copy it and run `doctor` against the official registry. `vibekit create --example headquarters` is the smaller getting-started scaffold (Chief + Personal + Telegram). Do not use `vibekit add headquarters`.

---

## Create it

From a published CLI:

```bash
npx --yes @useagentsio/cli@latest create ~/headquarters --example headquarters --provider openai --yes
cd ~/headquarters
```

From this repository:

```bash
pnpm exec tsx packages/cli/src/index.ts create ~/headquarters --example headquarters --provider openai --yes --registry registry
cd ~/headquarters
```

That installs `agent:chief`, `agent:personal`, `provider:openai`, `interface:telegram`, `policy:interface-pairing`, and `policy:untrusted-inbound`.

Interactive create (no `--yes`) prompts for missing **required secrets** declared on those modules (`OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN`). Values go to `~/.config/vibekit/<project>/env`, never YAML.

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

Keep this process up so Telegram can poll.

1. Message the bot. It replies with an **8-character** pairing code (expires in 1 hour).
2. In another terminal:

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

```bash
vibekit add agent researcher --yes
```

Then add `researcher` under `delegation.chief` in `.vibekit/project.yaml` if Chief should hand work there.

---

## Stop

`Ctrl+C` in the `vibekit start` terminal.
