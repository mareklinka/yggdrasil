import { Notice, Plugin } from 'obsidian';

export default class YggdrasilPlugin extends Plugin {
	public async onload(): Promise<void> {
		this.addCommand({
			id: 'hello-yggdrasil',
			name: 'Say Hello',
			callback: () => {
				new Notice('Yggdrasil plugin loaded successfully!');
			},
		});

		this.addRibbonIcon('sparkles', 'Yggdrasil', () => {
			new Notice('Yggdrasil is ready!');
		});

		console.log('Yggdrasil plugin loaded');
	}

	public onunload(): void {
		console.log('Yggdrasil plugin unloaded');
	}
}
