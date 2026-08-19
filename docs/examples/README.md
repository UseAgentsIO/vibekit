# VibeKit Project Examples

Welcome to the VibeKit project examples directory. These examples demonstrate how to design, configure, and operate real-world multi-agent systems using VibeKit's layered taxonomy:

$$\textbf{Components} \longrightarrow \textbf{Agents} \longrightarrow \textbf{Project} \longrightarrow \textbf{Host}$$

---

## 📁 Available Project Examples

### 1. [Headquarters: Minimal Life Coordinator Blueprint](headquarters/README.md)
* **Directory**: [`headquarters/`](headquarters/)
* **Description**: A streamlined starter blueprint pairing a central **Chief of Staff** with a specialized **Personal Director**. Designed as an educational foundation to teach users how to compose a front-door coordinator with a domain agent, and how to incrementally add their own custom agents (e.g., Health, Finance, Home, Career, or Engineering).
* **Key Concepts**: Single front-door intake via Telegram, hierarchical delegation (`Chief → Personal`), scoped SQLite memory, and step-by-step instructions for extending the workforce.

---

## 🎯 How to Use These Examples

1. **Minimal Architecture Reference**: Study `.vibekit/project.yaml` to see how a clean 2-agent composition and delegation rule is configured.
2. **Extensible Blueprint**: Follow the walkthrough in the README to add your own domain agents, skills, and tools.
3. **Interface & Host Wiring**: Learn how to attach external transports (like Telegram or Terminal) to an always-running Host daemon.

To add an example Project, keep it a composition of official Agents and Components (no marketplace, no `orchestrator` type). Follow [CONTRIBUTING.md](../../CONTRIBUTING.md).
