import type {
  App,
  ButtonComponent,
  TextComponent,
  ToggleComponent,
} from "obsidian";
import { Notice, PluginSettingTab, Setting } from "obsidian";

import type YggdrasilPlugin from "../main";
import type { YggdrasilSettings } from "../settings";
import { validateBaseUrl, validatePositiveInt } from "../settings";

export class YggdrasilSettingTab extends PluginSettingTab {
  readonly #plugin: YggdrasilPlugin;

  public constructor(app: App, plugin: YggdrasilPlugin) {
    super(app, plugin);
    this.#plugin = plugin;
  }

  public display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.#renderBasicSection();
    this.#renderAdvancedSection();
    this.#renderIndexingSection();
  }

  #renderBasicSection(): void {
    const { containerEl } = this;
    const settings: YggdrasilSettings = this.#plugin.getSettings();

    new Setting(containerEl).setName("Basic").setHeading();

    new Setting(containerEl)
      .setName("Chat model name")
      .setDesc("Name of the chat model")
      .addText((text: TextComponent): void => {
        text
          .setValue(settings.chatModelPath)
          .onChange(async (value: string): Promise<void> => {
            const updated: YggdrasilSettings = {
              ...this.#plugin.getSettings(),
              chatModelPath: value,
            };
            await this.#plugin.setSettings(updated);
          });
      });

    this.#renderBaseUrlSetting(
      containerEl,
      "Chat model base URL",
      "Base URL for the chat model API (OpenAI-compatible)",
      settings.chatModelBaseUrl,
      (value: string): YggdrasilSettings => ({
        ...this.#plugin.getSettings(),
        chatModelBaseUrl: value,
      }),
    );

    new Setting(containerEl)
      .setName("Chat model API key")
      .setDesc("Key for the chat model API")
      .addText((text: TextComponent): void => {
        text
          .setValue(settings.chatModelApiKey)
          .onChange(async (value: string): Promise<void> => {
            const updated: YggdrasilSettings = {
              ...this.#plugin.getSettings(),
              chatModelApiKey: value,
            };
            await this.#plugin.setSettings(updated);
          });
      });

    new Setting(containerEl)
      .setName("Vision model")
      .setDesc(
        "Enable to allow attaching images to chat messages. " +
          "Only enable if your chat model supports vision (e.g. gpt-4o, llama-3.2-vision).",
      )
      .addToggle((toggle: ToggleComponent): void => {
        toggle
          .setValue(settings.chatModelHasVision)
          .onChange(async (value: boolean): Promise<void> => {
            const updated: YggdrasilSettings = {
              ...this.#plugin.getSettings(),
              chatModelHasVision: value,
            };
            await this.#plugin.setSettings(updated);
          });
      });

    new Setting(containerEl)
      .setName("Embedding model name")
      .setDesc("Name of the embeddings model")
      .addText((text: TextComponent): void => {
        text
          .setValue(settings.embeddingsModelPath)
          .onChange(async (value: string): Promise<void> => {
            const updated: YggdrasilSettings = {
              ...this.#plugin.getSettings(),
              embeddingsModelPath: value,
            };
            await this.#plugin.setSettings(updated);
          });
      });

    this.#renderBaseUrlSetting(
      containerEl,
      "Embedding base URL",
      "Base URL for the embeddings API (OpenAI-compatible)",
      settings.embeddingsBaseUrl,
      (value: string): YggdrasilSettings => ({
        ...this.#plugin.getSettings(),
        embeddingsBaseUrl: value,
      }),
    );

    new Setting(containerEl)
      .setName("Embedding API key")
      .setDesc("Key for the embedding API")
      .addText((text: TextComponent): void => {
        text
          .setValue(settings.embeddingsApiKey)
          .onChange(async (value: string): Promise<void> => {
            const updated: YggdrasilSettings = {
              ...this.#plugin.getSettings(),
              embeddingsApiKey: value,
            };
            await this.#plugin.setSettings(updated);
          });
      });
  }

  #renderBaseUrlSetting(
    containerEl: HTMLElement,
    name: string,
    desc: string,
    initialValue: string,
    updater: (value: string) => YggdrasilSettings,
  ): void {
    new Setting(containerEl)
      .setName(name)
      .setDesc(desc)
      .addText((text: TextComponent): void => {
        text
          .setValue(initialValue)
          .onChange(async (value: string): Promise<void> => {
            const error: string | null = validateBaseUrl(value);
            if (error !== null) {
              text.inputEl.classList.add("yggdrasil-input-error");
              return;
            }
            text.inputEl.classList.remove("yggdrasil-input-error");
            await this.#plugin.setSettings(updater(value));
          });
      });
  }

  #renderAdvancedSection(): void {
    const { containerEl } = this;
    const settings: YggdrasilSettings = this.#plugin.getSettings();

    new Setting(containerEl).setName("Advanced").setHeading();

    this.#renderPositiveIntSetting(
      containerEl,
      "Embedding dimensions",
      "Number of embedding dimensions",
      settings.embeddingsDimensions,
      (value: number): YggdrasilSettings => ({
        ...settings,
        embeddingsDimensions: value,
      }),
    );

    this.#renderPositiveIntSetting(
      containerEl,
      "Chunk size",
      "Number of characters per chunk",
      settings.splitterChunkSize,
      (value: number): YggdrasilSettings => ({
        ...settings,
        splitterChunkSize: value,
      }),
    );

    this.#renderPositiveIntSetting(
      containerEl,
      "Chunk overlap",
      "Number of overlapping characters between chunks",
      settings.splitterChunkOverlap,
      (value: number): YggdrasilSettings => ({
        ...settings,
        splitterChunkOverlap: value,
      }),
    );
  }

  #renderPositiveIntSetting(
    containerEl: HTMLElement,
    name: string,
    desc: string,
    initialValue: number,
    updater: (value: number) => YggdrasilSettings,
  ): void {
    new Setting(containerEl)
      .setName(name)
      .setDesc(desc)
      .addText((text: TextComponent): void => {
        text
          .setValue(initialValue.toString())
          .onChange(async (value: string): Promise<void> => {
            const parsed: number = parseInt(value, 10);
            if (Number.isNaN(parsed)) {
              return;
            }
            const error: string | null = validatePositiveInt(parsed);
            if (error !== null) {
              text.inputEl.classList.add("yggdrasil-input-error");
              return;
            }
            text.inputEl.classList.remove("yggdrasil-input-error");
            await this.#plugin.setSettings(updater(parsed));
          });
        text.inputEl.type = "number";
      });
  }

  #renderIndexingSection(): void {
    const { containerEl } = this;
    const settings: YggdrasilSettings = this.#plugin.getSettings();

    new Setting(containerEl).setName("Indexing").setHeading();

    new Setting(containerEl)
      .setName("Re-index vault")
      .setDesc("Clear all embeddings and rebuild the index from scratch")
      .addButton((button: ButtonComponent): void => {
        button
          .setButtonText("Re-index vault")
          .setWarning()
          .onClick(async (): Promise<void> => {
            if (settings.embeddingsBaseUrl === "") {
              new Notice("Set Embedding Base URL before reindexing");
              return;
            }
            await this.#plugin.triggerReindex();
          });
      });
  }
}
