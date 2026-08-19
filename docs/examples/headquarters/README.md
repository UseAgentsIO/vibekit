# Headquarters — Mac Life Coordinator (Telegram)

An always-running personal assistant team that runs on your Mac and talks to you through Telegram.

Built with [VibeKit](file:///Users/sethrose/Documents/07_Projects/VibeKit-Agents/vibekit/README.md).

---

## 🌟 What is Headquarters?

Think of Headquarters as your personal AI command center:
1. **Chief of Staff (Your Front Door)**: You text the Chief on Telegram just like messaging a friend.
2. **Personal Director (Your Helper in the Background)**: When you give the Chief a job (like planning a trip or organizing a schedule), the Chief tells the Personal Director to do the background work, read your notes, and report back.
3. **Expandable**: You start with just these two agents, but you can add more whenever you want (like a Health Director, Finance Director, or Coding Agent).

---

## 📁 Where Does Headquarters Live on Your Mac?

**You can put Headquarters in whatever folder you want!**

For example, you can create a folder in your home directory called `~/headquarters`. 

Everything related to your assistant—your settings, conversation history, and saved memories—stays right inside that folder in a hidden `.vibekit/` folder. If you ever want to move it or back it up, you just move that one folder.

---

## 🚀 Step-by-Step Quickstart for Mac

### Step 1: Pick a Folder for Your Project
Open the **Terminal** app on your Mac and go to where you want to keep Headquarters:

```bash
# You can copy this example folder to your own home directory:
cp -r docs/examples/headquarters ~/headquarters
cd ~/headquarters
```

*(Or if you are exploring inside this repository: `cd docs/examples/headquarters`)*

---

### Step 2: Get Your Two Keys

You only need two keys to get started:

#### A. Your OpenAI Key (or your preferred AI model)
Get an API key from [platform.openai.com](https://platform.openai.com) and paste it:
```bash
export OPENAI_API_KEY="sk-proj-..."
```

#### B. Your Telegram Bot Token (Takes 1 minute)
1. Open the Telegram app on your phone or Mac.
2. Search for `@BotFather` and send the message `/newbot`.
3. Give your bot a name (e.g. `My Chief`) and a username (e.g. `my_chief_mac_bot`).
4. BotFather will give you a token. Copy it and paste it into your Terminal:
```bash
export TELEGRAM_BOT_TOKEN="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
```

> [!TIP]
> To save these keys permanently so you don't have to type them every time, add those two `export` lines to your `~/.zshrc` file.

---

### Step 3: Start Headquarters

In your terminal, run:
```bash
vibekit start
```

You'll see Headquarters start up. It is now listening for your messages!

---

### Step 4: Connect Telegram (One-Time Pairing)

1. Open Telegram and send any message (like `"Hello"`) to your new bot.
2. The bot will reply with a 6-digit **Pairing Code** (for example, `492041`). This protects your bot so nobody else can use it.
3. Open a new Terminal tab and approve the code:
   ```bash
   vibekit approve-pairing 492041
   ```

**You are all set!** You can now message your Chief of Staff from your phone or Mac anytime.

---

## 💬 Examples: How to Talk to Your Chief

Once paired, send messages directly to your bot on Telegram:

### Example 1: Planning a Busy Day
> **You**: `Plan my Saturday around my 2 PM dentist appointment. Make time for morning exercise and buying groceries.`  
> **Chief**: `I've got you covered! I've assigned this to the Personal Director to build your schedule.`  
> *(Personal Director works in the background)*  
> **Chief**: `Here is your Saturday schedule:`  
> `• 09:00 AM - Morning workout`  
> `• 11:00 AM - Grocery run`  
> `• 02:00 PM - Dentist appointment`  
> `• 04:00 PM - Free time`

---

### Example 2: Asking for Approval
Whenever the assistant wants to make an important change (like deleting an old file or finalizing a booking):
- It sends you an interactive message on Telegram with **Approve** and **Reject** buttons.
- Just tap **Approve** on your phone to let it proceed.

---

### Example 3: Automatic Daily Morning Briefings
You can ask your Chief to send you a briefing every morning:
> **You**: `Send me a summary of my top priorities every weekday morning at 8:00 AM.`

Headquarters sets a timer and will automatically message you on Telegram at 8:00 AM every Monday through Friday.

---

## 🔄 How to Keep Headquarters Running in the Background

If you don't want to keep a Terminal window open all the time, you can have your Mac run it silently in the background:

### The Easy Way: Run in the Background
```bash
# Start in the background
nohup vibekit start > .vibekit/runtime/host.log 2>&1 &

# Check on it anytime:
tail -f .vibekit/runtime/host.log
```

### The "Always On" Way: Mac LaunchAgent
If you want Headquarters to start automatically whenever you turn on your Mac:

1. Create a file called `~/Library/LaunchAgents/com.vibekit.headquarters.plist` with your project folder path:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.vibekit.headquarters</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/vibekit</string>
        <string>start</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/YOUR_USERNAME/headquarters</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
        <key>OPENAI_API_KEY</key>
        <string>sk-proj-...</string>
        <key>TELEGRAM_BOT_TOKEN</key>
        <string>123456789:ABC...</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/YOUR_USERNAME/headquarters/.vibekit/runtime/host.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/YOUR_USERNAME/headquarters/.vibekit/runtime/host.log</string>
</dict>
</plist>
```

2. Load it once:
```bash
launchctl load ~/Library/LaunchAgents/com.vibekit.headquarters.plist
```

Your Mac will now keep Headquarters running 24/7.

---

## ➕ How to Add More Agents (Like a Health Director)

When you're ready to add more helpers to your team, it's as simple as editing one file (`.vibekit/project.yaml`):

### 1. Add your new agent under `agentBindings`:
```yaml
agentBindings:
  chief:
    definition: agent:chief
  personal:
    definition: agent:personal
  health:
    definition: agent:director-health    # <-- Your new Health Director
```

### 2. Tell the Chief it can give work to Health:
```yaml
delegation:
  chief:
    - personal
    - health                             # <-- Chief can now delegate health tasks
  personal: []
  health: []
```

### 3. Message the Chief on Telegram:
> **You**: `Log my water intake for today and check if I hit my goal.`  
> **Chief**: *Hands the task to the Health Director and messages you back with the results.*

---

## 🛑 How to Stop Headquarters

- If running in a terminal: Press `Ctrl + C`.
- If running as a LaunchAgent: Run `launchctl unload ~/Library/LaunchAgents/com.vibekit.headquarters.plist`.
