/**
 * Stub module for the obsidian package.
 * Used by vitest aliases to replace the obsidian import in tests.
 */

export async function requestUrl(_options: unknown): Promise<{ status: number; json: unknown }> {
	return {
		status: 200,
		json: { data: [], model: '' },
	};
}

export const App = class {
	mock = true;
};

export const Modal = class {
	constructor(public app: unknown) {}
	open() {}
	close() {}
};

export const Notice = class {
	constructor(public message: string, public timeout?: number) {}
	setMessage(msg: string) {}
	hide() {}
};

export const Plugin = class {
	mock = true;
};

export const SettingTab = class {
	constructor(public app: unknown, public plugin: unknown) {}
};

export const ItemView = class {
	constructor(public app: unknown) {}
};

export const MarkdownRenderer = {
	render() {},
};

export const MetadataCache = {
	on() {},
	getFileCache() {
		return null;
	},
};

export const Vault = {
	on() {},
	getMarkdownFiles() {
		return [];
	},
};

export const Workspace = {
	onLayoutReady() {},
};

export const Platform = {
	electron: false,
	desktop: true,
	mobile: false,
};

export const TAbstractFile = class {};
export const TFile = class {
	path = '';
};
export const TFolder = class {
	path = '';
};
