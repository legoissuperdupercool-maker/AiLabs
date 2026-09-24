# AI Labs Office

A Windows desktop app where you run a team of up to **8 AI agents** in a 2D pixel-art office. Each agent has a desk, a department, a job title and a personality. You chat with them or give them tasks, and they do the work **on your PC**: they run commands, read and write files, browse the web and hand work to each other.

![icon](build/icon.png)

## Features

- **A living 2D office.** Agents walk around, grab coffee, sit on the couch and go back to their desks when there's work. Monitors light up while they code. Speech bubbles show what they're doing, and a bouncing `!` means an agent needs your approval. The windows follow your real clock (day, sunset, night).
- **8 departments:** Engineering, Research, Design, Marketing, Operations, Finance, Sales and Support. Each comes with its own colour, role suggestions and default instructions.
- **Task board** with Backlog, In progress, Done and Needs attention columns. Agents can **delegate** tasks to coworkers with the `delegate_task` tool. You'll see the delegating agent walk over to the other agent's desk.
- **Works with any AI:**
  - Cloud: **Anthropic (Claude)**, **OpenAI (ChatGPT)**, **Groq**, **Google Gemini**, **OpenRouter**, **Mistral**, **DeepSeek** and **xAI (Grok)**
  - Local: **Ollama** and **LM Studio**, or any **OpenAI-compatible** server
  - Every agent can use a different provider and model.
- **Real computer control** through tools: `run_command` (PowerShell), `read_file`, `write_file`, `edit_file`, `list_directory`, `search_files`, `fetch_url`, `open_on_computer`, `clipboard`, `system_info`, `notify_user` and `delegate_task`.
- **Per-agent safety levels:**
  - **Ask first** (default): the agent reads freely and writes inside the workspace folder. Commands and changes outside the workspace pop up an approval dialog with *Deny*, *Allow once* and *Always allow* buttons.
  - **Full auto:** no prompts.
  - **Read-only:** the agent can look but can't change anything.
- Character creator (hair, skin, shirt), levels, token counters, an activity feed and sound effects.
- API keys and chat histories stay on your computer, in `%APPDATA%\AI Labs Office\office`.

## Install (Windows)

1. Get `AI-Labs-Office-Setup-<version>.exe` from one of these places:
   - the **Releases** page (builds for `v*` tags)
   - the **Actions** tab → latest *Build Windows installer* run → artifact
2. Run it. The installer lets you pick the install folder and creates Start-menu and desktop shortcuts.
3. Launch **AI Labs Office** and pick a provider on the welcome screen. After that you can hire the starter team in one click.

> The installer isn't code-signed, so Windows SmartScreen may warn you. Click *More info → Run anyway*.

### Using local models

- **Ollama:** install from ollama.com, then run `ollama pull llama3.1` (or `qwen2.5`, which is good at tool calling). In the app, add the *Ollama (local)* provider. No API key is needed.
- **LM Studio:** start the local server (default `http://localhost:1234/v1`) and add the *LM Studio (local)* provider.

Agents rely on **tool/function calling**. Pick a model that supports it, such as Llama 3.1+, Qwen 2.5+ or Mistral Nemo.

## Develop

```bash
npm install
npm start            # run the app
npm run mock         # fake OpenAI-compatible LLM on http://localhost:11999/v1 (no key needed)
npm run dist         # build dist/AI-Labs-Office-Setup-<version>.exe
```

`npm run dist` works best on Windows. On Linux it also needs `wine` and `wine32`. Pushing a tag like `v1.0.0` makes GitHub Actions build the installer on Windows and attach it to a release.

### Project layout

```
electron/
  main.js        window, IPC
  office.js      agents, task board, agent work loop, approvals, delegation
  providers.js   Anthropic (official SDK) + OpenAI-compatible providers
  tools.js       what agents can do on the PC + permission rules
  store.js       JSON persistence in the user's app-data folder
renderer/
  index.html, styles.css
  js/scene.js    the 2D office (canvas, pathfinding, animations)
  js/sprites.js  procedural pixel-art characters
  js/app.js      UI: roster, chat, task board, settings, modals
scripts/
  make-icon.js   generates build/icon.png
  mock-llm.js    fake LLM for testing
```
