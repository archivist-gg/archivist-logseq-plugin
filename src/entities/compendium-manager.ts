import * as yaml from "js-yaml";
import {
  TYPE_FOLDER_MAP,
  slugify,
  ensureUniqueSlug,
} from "./entity-vault-store";
import { EntityRegistry, RegisteredEntity } from "./entity-registry";

// ---------------------------------------------------------------------------
// Compendium interface
// ---------------------------------------------------------------------------

export interface Compendium {
  name: string;
  description: string;
  readonly: boolean;
  homebrew: boolean;
}

// ---------------------------------------------------------------------------
// LogseqApi — typed subset of the Logseq plugin API used by this module
// ---------------------------------------------------------------------------

export interface LogseqApi {
  Editor: {
    getPage(name: string): Promise<{ name: string; originalName: string; properties: Record<string, any> } | null>;
    createPage(
      name: string,
      properties: Record<string, any>,
      opts?: { redirect?: boolean },
    ): Promise<{ name: string; originalName: string; properties: Record<string, any> } | null>;
    deletePage(name: string): Promise<void>;
    getPageBlocksTree(name: string): Promise<{ uuid: string; content: string }[]>;
    appendBlockInPage(name: string, content: string): Promise<{ uuid: string; content: string } | null>;
    updateBlock(uuid: string, content: string): Promise<void>;
  };
  DB: {
    datascriptQuery(query: string, ...inputs: any[]): Promise<any[]>;
  };
}

// ---------------------------------------------------------------------------
// Logseq property key normalization helper
// ---------------------------------------------------------------------------

/**
 * Logseq normalizes property keys inconsistently across API surfaces.
 * A key written as "entity-type" in createPage may be returned as
 * "entityType" (camelCase), "entity_type" (snake_case), or "entitytype"
 * (flatcase) when read back via datascriptQuery + page.properties.
 *
 * This helper tries the original key plus all normalized variants.
 */
function prop(props: Record<string, any>, key: string, fallback?: any): any {
  if (key in props) return props[key];

  // Try camelCase: "entity-type" -> "entityType"
  const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  if (camel in props) return props[camel];

  // Try snake_case: "entity-type" -> "entity_type"
  const snake = key.replace(/-/g, "_");
  if (snake in props) return props[snake];

  // Try flatcase: "entity-type" -> "entitytype"
  const flat = key.replace(/-/g, "");
  if (flat in props) return props[flat];

  return fallback;
}

function isTruthy(val: any): boolean {
  return val === true || val === "true";
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Build the namespaced page name for an entity.
 * E.g. buildEntityPageName("SRD", "monster", "Goblin") => "SRD/Monsters/Goblin"
 */
export function buildEntityPageName(
  compendiumName: string,
  entityType: string,
  entityName: string,
): string {
  const typeFolder = TYPE_FOLDER_MAP[entityType] || entityType;
  return `${compendiumName}/${typeFolder}/${sanitizePageName(entityName)}`;
}

/**
 * Sanitize a string for use as a Logseq page name segment.
 * Removes characters that are problematic in page names.
 */
export function sanitizePageName(name: string): string {
  return name.replace(/[#^[\]|]/g, "").trim();
}

/**
 * Build a fenced code block string containing YAML-serialized data.
 */
export function buildFencedCodeBlock(
  entityType: string,
  data: Record<string, unknown>,
): string {
  const body = yaml.dump(data, { lineWidth: -1, noRefs: true, sortKeys: false });
  return `\`\`\`${entityType}\n${body}\`\`\``;
}

/**
 * Extract YAML data from a block whose content contains a fenced code block.
 * Returns null if no valid fenced block is found.
 */
export function extractYamlFromBlock(
  blockContent: string,
): Record<string, unknown> | null {
  const match = blockContent.match(/```\w+\n([\s\S]*?)```/);
  if (!match) return null;

  try {
    const parsed = yaml.load(match[1]) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// CompendiumManager
// ---------------------------------------------------------------------------

/**
 * Central module for compendium-level operations in Logseq.
 * Uses Logseq's page/block API and namespaced pages instead of Obsidian's
 * vault folders and markdown files.
 *
 * - Compendiums are stored as top-level pages with `archivist-compendium:: true`
 * - Entities are stored as namespaced pages: `CompendiumName/TypeFolder/EntityName`
 * - Entity data lives in a fenced code block appended as the first block
 */
export class CompendiumManager {
  private compendiums = new Map<string, Compendium>();
  private registry: EntityRegistry;
  private api: LogseqApi;

  constructor(registry: EntityRegistry, api: LogseqApi) {
    this.registry = registry;
    this.api = api;
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  /** List all compendiums. */
  getAll(): Compendium[] {
    return Array.from(this.compendiums.values());
  }

  /** Only non-readonly compendiums. */
  getWritable(): Compendium[] {
    return this.getAll().filter((c) => !c.readonly);
  }

  /** Look up a specific compendium by name. */
  getByName(name: string): Compendium | undefined {
    return this.compendiums.get(name);
  }

  /** Add a compendium to the internal Map. */
  addCompendium(comp: Compendium): void {
    this.compendiums.set(comp.name, comp);
  }

  // -------------------------------------------------------------------------
  // Discovery & loading
  // -------------------------------------------------------------------------

  /**
   * Discover compendiums by querying Logseq for pages with the
   * `archivist-compendium` property set to true.
   *
   * Uses a single bulk Datascript pull query instead of iterating
   * namespace parents with individual getPage() calls.
   */
  async discover(): Promise<void> {
    // One query: get all namespace parent pages with their properties
    const nsResults = await this.api.DB.datascriptQuery(
      `[:find (pull ?ns [:block/name :block/original-name :block/properties])
        :where
        [?p :block/namespace ?ns]]`,
    );

    // Deduplicate (a parent appears once per namespace child)
    const seen = new Set<string>();

    console.log("[archivist] discover() processing", nsResults.length, "namespace results");

    for (const [page] of nsResults) {
      try {
        if (!page?.properties) continue;

        const pageName = (page["original-name"] || page.name) as string;
        if (!pageName || seen.has(pageName)) continue;
        seen.add(pageName);

        const flag = prop(page.properties, "archivist-compendium");
        if (!isTruthy(flag)) continue;

        const comp: Compendium = {
          name: pageName,
          description: prop(page.properties, "compendium-description", "") as string,
          readonly: isTruthy(prop(page.properties, "compendium-readonly", false)),
          homebrew: isTruthy(prop(page.properties, "compendium-homebrew", false)),
        };

        this.addCompendium(comp);
        console.log("[archivist] discover() found compendium:", comp.name);
      } catch {
        // skip
      }
    }
  }

  /**
   * Load all entities from all known compendiums by querying Logseq for
   * pages with the `archivist` property set to true. Reads block content
   * to extract the fenced code block YAML data.
   *
   * Uses 2 parallel bulk Datascript queries per compendium instead of
   * individual getPage() + getPageBlocksTree() calls per entity.
   *
   * Returns the total count of entities loaded.
   */
  async loadAllEntities(): Promise<number> {
    let totalCount = 0;

    for (const [compName, comp] of this.compendiums) {
      // Two parallel queries replace ~1920 sequential IPC calls:
      const [entityResults, blockResults] = await Promise.all([
        // Query 1: entity pages with properties (grandchildren of compendium)
        this.api.DB.datascriptQuery(
          `[:find (pull ?entity [:block/name :block/original-name :block/properties])
            :in $ ?comp-name
            :where
            [?comp :block/name ?comp-name]
            [?type :block/namespace ?comp]
            [?entity :block/namespace ?type]]`,
          `"${compName.toLowerCase()}"`,
        ),
        // Query 2: block content for entity pages
        this.api.DB.datascriptQuery(
          `[:find ?entity-name ?content
            :in $ ?comp-name
            :where
            [?comp :block/name ?comp-name]
            [?type :block/namespace ?comp]
            [?entity :block/namespace ?type]
            [?entity :block/name ?entity-name]
            [?b :block/page ?entity]
            [?b :block/content ?content]]`,
          `"${compName.toLowerCase()}"`,
        ),
      ]);

      // Build content map: page-name -> block contents
      const contentByPage = new Map<string, string[]>();
      for (const [pageName, content] of blockResults) {
        if (typeof pageName !== "string" || typeof content !== "string") continue;
        if (!contentByPage.has(pageName)) contentByPage.set(pageName, []);
        contentByPage.get(pageName)!.push(content);
      }

      console.log(
        "[archivist] loadAllEntities() compendium",
        compName,
        ":",
        entityResults.length,
        "entity pages",
      );

      // Process entity pages
      for (const [entity] of entityResults) {
        try {
          if (!entity?.properties) continue;
          const props = entity.properties;

          const archivistFlag = prop(props, "archivist");
          if (!isTruthy(archivistFlag)) continue;

          let entityType = prop(props, "entity-type") as string | undefined;
          if (entityType === "magic-item") entityType = "item";
          const slug = prop(props, "slug") as string | undefined;
          const name = prop(props, "name") as string | undefined;
          const compendiumName = prop(props, "compendium") as string | undefined;

          if (
            typeof entityType !== "string" ||
            typeof slug !== "string" ||
            typeof name !== "string" ||
            typeof compendiumName !== "string"
          ) {
            continue;
          }

          // Extract YAML data from block content
          const pageName = (entity["original-name"] || entity.name) as string;
          let data: Record<string, unknown> = {};

          const blocks = contentByPage.get(entity.name as string) ?? [];
          for (const blockContent of blocks) {
            const extracted = extractYamlFromBlock(blockContent);
            if (extracted) {
              data = extracted;
              break;
            }
          }

          const registered: RegisteredEntity = {
            slug,
            name,
            entityType,
            filePath: pageName,
            data,
            compendium: compendiumName,
            readonly: comp.readonly,
            homebrew: comp.homebrew,
          };

          this.registry.register(registered);
          totalCount++;
        } catch {
          // Skip inaccessible pages
        }
      }
    }

    return totalCount;
  }

  // -------------------------------------------------------------------------
  // CRUD
  // -------------------------------------------------------------------------

  /**
   * Create a new compendium as a Logseq page with properties.
   */
  async create(
    name: string,
    description: string,
    homebrew: boolean,
    readonly: boolean,
  ): Promise<Compendium> {
    const comp: Compendium = { name, description, readonly, homebrew };

    await this.api.Editor.createPage(
      name,
      {
        "archivist-compendium": true,
        "compendium-description": description,
        "compendium-readonly": readonly,
        "compendium-homebrew": homebrew,
      },
      { redirect: false },
    );

    this.addCompendium(comp);
    return comp;
  }

  /**
   * Save a new entity as a namespaced page in its compendium.
   * Creates the page with properties and appends a fenced code block.
   */
  async saveEntity(
    compendiumName: string,
    entityType: string,
    data: Record<string, unknown>,
  ): Promise<RegisteredEntity> {
    const comp = this.compendiums.get(compendiumName);
    if (!comp) {
      throw new Error(`Compendium not found: ${compendiumName}`);
    }

    const name = data.name as string;
    if (!name) {
      throw new Error("Entity data must include a 'name' field");
    }

    const baseSlug = slugify(name);
    const slug = ensureUniqueSlug(baseSlug, this.registry.getAllSlugs());

    const pageName = buildEntityPageName(compendiumName, entityType, name);

    // Create the namespaced page with properties
    await this.api.Editor.createPage(
      pageName,
      {
        archivist: true,
        "entity-type": entityType,
        slug,
        name,
        compendium: compendiumName,
      },
      { redirect: false },
    );

    // Append the fenced code block as the first block
    const codeBlock = buildFencedCodeBlock(entityType, data);
    await this.api.Editor.appendBlockInPage(pageName, codeBlock);

    const registered: RegisteredEntity = {
      slug,
      name,
      entityType,
      filePath: pageName,
      data,
      compendium: compendiumName,
      readonly: comp.readonly,
      homebrew: comp.homebrew,
    };

    this.registry.register(registered);
    return registered;
  }

  /**
   * Update an existing entity's data by replacing the content of its
   * first block with a new fenced code block.
   */
  async updateEntity(
    slug: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const existing = this.registry.getBySlug(slug);
    if (!existing) {
      throw new Error(`Entity not found: ${slug}`);
    }

    // Get the first block to find its UUID
    const blocks = await this.api.Editor.getPageBlocksTree(existing.filePath);
    if (blocks.length === 0) {
      throw new Error(`No blocks found on entity page: ${existing.filePath}`);
    }

    const codeBlock = buildFencedCodeBlock(existing.entityType, data);
    await this.api.Editor.updateBlock(blocks[0].uuid, codeBlock);

    // Re-register with updated data
    const updated: RegisteredEntity = {
      ...existing,
      data,
    };
    this.registry.register(updated);
  }

  /**
   * Delete an entity page and unregister it from the registry.
   */
  async deleteEntity(slug: string): Promise<void> {
    const existing = this.registry.getBySlug(slug);
    if (!existing) {
      throw new Error(`Entity not found: ${slug}`);
    }

    await this.api.Editor.deletePage(existing.filePath);
    this.registry.unregister(slug);
  }

  /**
   * Count references to a slug across Logseq pages using Datascript query.
   * Looks for {{type:slug}} or {{slug}} patterns in block content.
   */
  async countReferences(
    slug: string,
    excludePageName?: string,
  ): Promise<number> {
    const entity = this.registry.getBySlug(slug);
    const entityPageName = entity?.filePath;

    // Query for blocks containing the slug pattern
    const results = await this.api.DB.datascriptQuery(
      `[:find (pull ?b [:block/content :block/page])
        :where
        [?b :block/content ?c]
        [(clojure.string/includes? ?c "${slug}")]]`,
    );

    let count = 0;
    const countedPages = new Set<string>();

    for (const [block] of results) {
      if (!block || !block.content) continue;

      // Get the page name from the block
      const pageName = block.page?.originalName || block.page?.name;
      if (pageName === entityPageName) continue;
      if (excludePageName && pageName === excludePageName) continue;
      if (countedPages.has(pageName)) continue;

      // Check for actual reference patterns
      const refPatterns = [
        `{{${slug}}}`,
        `{{monster:${slug}}}`,
        `{{spell:${slug}}}`,
        `{{item:${slug}}}`,
      ];

      if (refPatterns.some((p) => block.content.includes(p))) {
        countedPages.add(pageName);
        count++;
      }
    }

    return count;
  }
}
