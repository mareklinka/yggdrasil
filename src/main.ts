import type { App, TAbstractFile } from 'obsidian';
import { Modal, Notice, Plugin } from 'obsidian';

import { Indexer, type IndexerConfig, type IndexProgress, type IndexResult } from './rag/indexer';

const EMBEDDING_DIMENSIONS = 1024;
const VECTOR_DB_DIR = '.yggdrasil/vectors.lancedb';

export default class YggdrasilPlugin extends Plugin {
	#indexer: Indexer | null = null;

	public async onload(): Promise<void> {
		this.addCommand({
			id: 'hello-yggdrasil',
			name: 'Say Hello',
			callback: () => {
				new Notice('Yggdrasil plugin loaded successfully!');
			},
		});

		this.addRibbonIcon('sparkles', 'Yggdrasil', () => {
			this.#showReindexConfirmation();
		});

		console.log('Yggdrasil plugin loaded');
	}

	public onunload(): void {
		console.log('Yggdrasil plugin unloaded');
	}

	async #showReindexConfirmation(): Promise<void> {
		const modal = new ReindexConfirmationModal(this.app);
		modal.open();

		modal.onConfirmed = async (): Promise<void> => {
			await this.#runReindex();
		};
	}

	async #runReindex(): Promise<void> {
		const adapter = this.app.vault.adapter as unknown as { getBasePath: () => string };
		const basePath = adapter.getBasePath();
		const dbPath = `${basePath}/${VECTOR_DB_DIR}`;

		const config: IndexerConfig = {
			dbPath,
			dimensions: EMBEDDING_DIMENSIONS,
		};

		this.#indexer = new Indexer(config, {
			getMarkdownFiles: (): Array<{ path: string }> =>
				this.app.vault.getMarkdownFiles().map((f: TAbstractFile) => ({ path: f.path })),
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Obsidian API limitation
			read: async (file: { path: string }): Promise<string> => (this.app.vault as any).read(file),
		});

		const notice = new Notice('', 0);

		const onUpdate = (progress: IndexProgress): void => {
			let message = '';

			switch (progress.phase) {
				case 'scanning':
					message = '🔍 Scanning vault for markdown files...';
					break;
				case 'indexing':
					if (progress.total > 0) {
						message = `📝 Indexing: ${progress.current}/${progress.total} notes`;
						if (progress.currentFile) {
							message += `\n${progress.currentFile}`;
						}
					} else {
						message = '📝 No markdown files found.';
					}
					break;
				case 'storing':
					message = `💾 Storing ${progress.chunksCreated} chunks...`;
					break;
				case 'complete':
					message = `✅ Indexing complete: ${progress.chunksCreated} chunks from ${progress.current} notes`;
					notice.hide();
					break;
				case 'error':
					message = `❌ Indexing failed: ${progress.errorMessage}`;
					notice.hide();
					break;
			}

			if (progress.errors.length > 0 && progress.phase !== 'complete' && progress.phase !== 'error') {
				message += `\n⚠ ${progress.errors.length} error(s)`;
			}

			notice.setMessage(message);
		};

		const indexer = this.#indexer;
		if (indexer === null) {
			throw new Error('Indexer not initialized');
		}
		const result: IndexResult = await indexer.reindex(onUpdate);

		if (!result.success) {
			new Notice(`❌ Indexing failed: ${result.errors.join('; ')}`, 10000);
		} else if (result.errors.length > 0) {
			new Notice(
				`⚠ Indexing complete with ${result.errors.length} error(s). Check console for details.`,
				10000
			);
			for (const error of result.errors) {
				console.warn('Yggdrasil indexing error:', error);
			}
		} else {
			new Notice(
				`✅ Indexed ${result.chunksCreated} chunks from ${result.filesScanned} notes`,
				5000
			);
		}
	}
}

class ReindexConfirmationModal extends Modal {
	public onConfirmed: (() => void) | null = null;

	public constructor(app: App) {
		super(app);
	}

	public onOpen(): void {
		const { contentEl } = this;

		contentEl.createEl('h2', { text: 'Reindex Vault' });
		contentEl.createEl('p', {
			text: 'This will clear all embeddings and rebuild the index. This may take a while.',
		});

		const buttonContainer = contentEl.createDiv({ cls: 'mod-footer' });

		const cancelButton = buttonContainer.createEl('button', {
			text: 'Cancel',
		});
		cancelButton.addEventListener('click', () => {
			this.close();
		});

		const confirmButton = buttonContainer.createEl('button', {
			text: 'Reindex',
		});
		confirmButton.classList.add('mod-warning');
		confirmButton.addEventListener('click', () => {
			this.close();
			if (this.onConfirmed) {
				this.onConfirmed();
			}
		});
	}

	public onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
