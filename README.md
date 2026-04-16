# Archivist TTRPG Blocks — Logseq Plugin

A D&D 5e toolkit for [Logseq](https://logseq.com) that renders parchment-styled stat blocks, inline dice tags, in-place editing with custom controls, and a full SRD compendium.

## Features

- **Stat blocks** -- Monster, spell, and magic item blocks rendered as parchment cards from YAML in fenced code blocks
- **Inline dice notation** -- Highlighted dice formulas inline in stat blocks (e.g., `` `dice:2d6+3` ``, `` `atk:STR` ``, `` `damage:1d8+DEX` ``)
- **In-place edit mode** -- Edit stat blocks with custom number spinners, searchable tag selects, proficiency toggles, feature cards, and section tabs
- **SRD compendium** -- 300+ monsters, spells, and items from the D&D 5e SRD, importable via command palette
- **Two-column layout** -- PHB-style two-column monster stat blocks
- **Entity search** -- Search and insert any entity from the compendium

## Usage

Create a fenced code block with the appropriate language tag:

### Monster

````markdown
```monster
name: Young Red Dragon
size: Large
type: dragon
alignment: chaotic evil
cr: "10"
ac:
  - ac: 18
    from:
      - natural armor
hp:
  average: 178
  formula: 17d10+85
speed:
  walk: 40
  climb: 40
  fly: 80
abilities:
  str: 23
  dex: 10
  con: 21
  int: 14
  wis: 11
  cha: 19
```
````

### Spell

````markdown
```spell
name: Fireball
level: 3
school: Evocation
casting_time: 1 action
range: 150 feet
components: V, S, M (a tiny ball of bat guano and sulfur)
duration: Instantaneous
description:
  - A bright streak flashes from your pointing finger...
```
````

### Magic Item

````markdown
```item
name: Flame Tongue
type: Weapon (any sword)
rarity: rare
attunement: true
entries:
  - You can use a bonus action to speak this magic sword's command word...
```
````

Or use the slash commands: `/Monster Block`, `/Spell Block`, `/Item Block` to insert templates.

## Installation

**Logseq Marketplace (coming soon):**
Search "Archivist" in the Logseq plugin marketplace.

**Manual / Beta Testing:**
1. Enable **Developer mode** in Logseq Settings
2. Download the latest release zip from [GitHub Releases](https://github.com/archivist-gg/archivist-logseq-plugin/releases)
3. Extract the zip to a folder
4. In Logseq, go to Plugins (three dots menu) and click **"Load unpacked plugin"**
5. Select the extracted folder

> ⚠️ **Windows users — unblock the ZIP before extracting.** Windows tags files downloaded from the internet (Mark of the Web), and Logseq's Electron runtime refuses to load plugins with that mark — you'll see `Not allowed to load local resource` and a `loadhandshake Timeout` in the console. Right-click the downloaded `.zip` → **Properties** → check **Unblock** → **OK**, *then* extract. If you already extracted, run this in PowerShell on the plugin folder:
>
> ```powershell
> Get-ChildItem -Path "C:\path\to\archivist-logseq-plugin" -Recurse | Unblock-File
> ```
>
> Then restart Logseq and reload the unpacked plugin. Installing from a path outside `Downloads` (e.g. `C:\logseq-plugins\archivist`) avoids related edge cases.

**From Source:**
```bash
git clone https://github.com/archivist-gg/archivist-logseq-plugin.git
cd archivist-logseq-plugin
npm install
npm run build
```
Then load the repo directory as an unpacked plugin in Logseq.

## SRD Import

After installing, import the bundled SRD compendium:

1. Open the command palette (`Cmd/Ctrl+Shift+P`)
2. Run **"Archivist: Import SRD Compendium"**
3. Wait for the progress messages — 960+ entities will be created as Logseq pages under the `SRD/` namespace
4. Once complete, you'll see a confirmation with the total entity count

The SRD data is loaded on demand when you run the import command, so it does not affect plugin startup time.

## Archivist Inquiry (AI Chat)

Archivist Inquiry is a local D&D 5e chat assistant that runs entirely on your machine. A small sidecar server (`archivist-bridge`) spawns Claude Code as the AI engine and the plugin talks to it over a localhost WebSocket.

**Prerequisites:**
- [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) installed and **already logged in** on your machine. The sidecar shells out to the `claude` CLI, so no `ANTHROPIC_API_KEY` is needed — your Claude Code session handles auth.
- Node.js 18 or newer.

**Start the sidecar (once per Logseq session):**

```bash
npx archivist-bridge --graph /path/to/your/logseq-graph
```

Point `--graph` at the folder Logseq has open (the one containing your `pages/` and `journals/` directories). The sidecar auto-picks a port in `52340–52360`, writes a discovery file at `<graph>/.archivist/server.json`, and prints the URL it's listening on. Leave this terminal window running.

Useful flags:
- `--port <n>` — pin a specific port instead of auto-selecting
- `--help` — show all options

**Open the Inquiry panel in Logseq:**

1. Press `Cmd/Ctrl+Shift+I`, or run **"Toggle Archivist Inquiry"** from the command palette
2. The panel slides in and auto-discovers the running sidecar
3. Ask a question — e.g. "stat block for a level 5 goblin druid", "what does Counterspell do at higher levels?", "roll initiative for this encounter"
4. Use **"Archivist Inquiry: New Session"** from the command palette to start a fresh conversation

If the panel shows "disconnected", confirm the sidecar terminal is still running and that `--graph` points at the same vault Logseq has open.

## Testing the Plugin

After installation, try these features to verify everything works:

### Stat Blocks

1. Create a new block and type `/Monster Block` (or `/Spell Block`, `/Item Block`)
2. A YAML template will be inserted — the stat block renders automatically
3. Click the **edit** button (pencil icon, right side) to enter edit mode
4. Click the **columns** button to toggle two-column layout (monsters only)
5. Click the **source** button (`</>`) to view raw YAML

### Dice Rolling

1. In a rendered stat block, look for highlighted pills (attack bonuses, damage dice, etc.)
2. Click any pill to trigger a 3D dice animation
3. The result appears as a toast notification in the top-right corner
4. Adjust animation duration in Settings → Plugin Settings → Archivist → Dice Animation Duration

### Inline Dice Tags

In any Logseq block, use inline code with dice notation:

- `` `dice:2d6+3` `` — rolls 2d6+3
- `` `atk:STR` `` — shows an attack modifier
- `` `damage:1d8+DEX` `` — shows damage dice

These render as styled pills that are clickable when dice rolling is enabled.

### Compendium Browsing

After importing the SRD, browse entities in the Logseq sidebar:

- Navigate to the `SRD` page to see the compendium root
- Entities are organized as `SRD/Monsters/Goblin`, `SRD/Spells/Fireball`, etc.
- Each entity page contains a fenced code block that renders as a stat block

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Two-column monster layout | Render monsters in two-column PHB style | Off |
| Default block mode | Open blocks in rendered view or raw YAML | View |
| Enable Dice Rolling | Click rollable pills to trigger 3D dice | On |
| Dice Animation Duration | How long the dice overlay stays visible (ms) | 3000 |

## License

[AGPL-3.0](LICENSE)
