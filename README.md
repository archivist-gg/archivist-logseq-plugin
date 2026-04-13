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
size: large
type: dragon
alignment: chaotic evil
ac: 18 (natural armor)
hp: 178 (17d10+85)
speed: 40 ft., climb 40 ft., fly 80 ft.
abilities: [23, 10, 21, 14, 11, 19]
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
3. 300+ monsters, spells, and items will be created as Logseq pages

## License

[AGPL-3.0](LICENSE)
