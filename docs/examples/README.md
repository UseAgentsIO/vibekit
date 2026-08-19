# VibeKit Project Examples

Welcome to the VibeKit project examples directory. These examples demonstrate how to design, configure, and operate real-world multi-agent systems using VibeKit's layered taxonomy:

$$\textbf{Components} \longrightarrow \textbf{Agents} \longrightarrow \textbf{Project} \longrightarrow \textbf{Host}$$

---

## 📁 Available Project Examples

### 1. [Headquarters: Minimal Life Coordinator Blueprint](headquarters/README.md)
* **Directory**: [`headquarters/`](headquarters/)
* **Description**: Copyable Chief + Personal Project on Telegram. Scaffold with `vibekit create ~/headquarters --example headquarters`.
* **Key Concepts**: Telegram pairing, `agent:chief` → `agent:personal` delegation, required secrets from module manifests.

---

## 🎯 How to Use These Examples

1. **Create the Project**: `vibekit create ~/headquarters --example headquarters --provider openai --yes` then `vibekit start`.
2. **Extensible Blueprint**: Follow the walkthrough in the README to add your own domain agents, skills, and tools.
3. **Interface & Host Wiring**: Learn how to attach external transports (like Telegram or Terminal) to an always-running Host daemon.

To add an example Project, keep it a composition of official Agents and Components (no marketplace, no `orchestrator` type). Follow [CONTRIBUTING.md](../../CONTRIBUTING.md).
