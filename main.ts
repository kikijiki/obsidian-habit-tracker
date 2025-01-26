import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, ItemView, ToggleComponent, TFile, MetadataCache } from 'obsidian';
import * as yaml from 'js-yaml';

const HABIT_TRACKER_VIEW_TYPE = 'kikijiki-habit-tracker-view';

interface KikijikiHabitTrackerSettings {
	tagPrefix: string;
	habits: string[];
}

const DEFAULT_SETTINGS: KikijikiHabitTrackerSettings = {
	tagPrefix: 'habit',
	habits: []
}

export default class KikijikiHabitTracker extends Plugin {
	settings: KikijikiHabitTrackerSettings;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new KikijikiHabitTrackerSettingTab(this.app, this));

		this.registerView(
			HABIT_TRACKER_VIEW_TYPE,
			(leaf) => new HabitTrackerView(leaf, this)
		);

		this.addCommand({
			id: 'open-panel',
			name: 'Open panel',
			callback: () => {
				this.activateView();
			}
		});

		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				const view = this.app.workspace.getLeavesOfType(HABIT_TRACKER_VIEW_TYPE)[0]?.view as HabitTrackerView;
				if (view) {
					view.render();
				}
			})
		);
	}

	async activateView() {
		let rightLeaf = this.app.workspace.getRightLeaf(false);
		if (!rightLeaf) {
			rightLeaf = this.app.workspace.getRightLeaf(true);
		}
		if (rightLeaf) {
			rightLeaf.setViewState({
				type: HABIT_TRACKER_VIEW_TYPE,
				active: true,
			});
			this.app.workspace.revealLeaf(rightLeaf);
		}
	}

	onunload() {
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class KikijikiHabitTrackerSettingTab extends PluginSettingTab {
	plugin: KikijikiHabitTracker;

	constructor(app: App, plugin: KikijikiHabitTracker) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Tag prefix')
			.setDesc('Prefix for tags, the final tag will be <prefix>/<habit>.')
			.addText(text => text
				.setPlaceholder('Enter tag prefix')
				.setValue(this.plugin.settings.tagPrefix)
				.onChange(async (value) => {
					this.plugin.settings.tagPrefix = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Habits')
			.setDesc('List of habits that will appear in the panel.');

		this.plugin.settings.habits.forEach((habit, index) => {
			new Setting(containerEl)
				.setName(`Habit ${index + 1}`)
				.addText(text => text
					.setValue(habit)
					.onChange(async (value) => {
						this.plugin.settings.habits[index] = value;
						await this.plugin.saveSettings();
					}))
				.addButton(button => {
					button.setButtonText('Remove');
					button.onClick(async () => {
						this.plugin.settings.habits.splice(index, 1);
						await this.plugin.saveSettings();
						this.display();
					});
				});
		});

		new Setting(containerEl)
			.addButton(button => {
				button.setButtonText('Add habit');
				button.onClick(() => {
					this.plugin.settings.habits.push('');
					this.display();
				});
			});
	}
}

class HabitTrackerView extends ItemView {
	plugin: KikijikiHabitTracker;
	private settings: Setting[] = [];
	private currentFile: string | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: KikijikiHabitTracker) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return HABIT_TRACKER_VIEW_TYPE;
	}

	getDisplayText() {
		return 'Habit tracker';
	}

	getIcon() {
		return "checkbox-glyph";
	}

	async onOpen() {
		this.render();
	}

	async onClose() {
		this.clearSettings();
	}

	private clearSettings() {
		this.settings.forEach(setting => setting.settingEl.remove());
		this.settings = [];
	}

	async render() {
		const { contentEl } = this;
		const activeFile = this.app.workspace.getActiveFile();

		if (activeFile?.path === this.currentFile) {
			return;
		}

		this.currentFile = activeFile?.path ?? null;
		contentEl.empty();
		this.clearSettings();

		if (!activeFile) {
			contentEl.setText('No file is open');
			return;
		}

		const cache = this.app.metadataCache.getFileCache(activeFile);
		const frontmatter = cache?.frontmatter || {};
		const existingTags = frontmatter.tags || [];

		this.plugin.settings.habits.forEach(habit => {
			const tag = `${this.plugin.settings.tagPrefix}/${habit}`;
			const setting = new Setting(contentEl)
				.setName(habit)
				.addToggle(toggle => {
					toggle.setValue(existingTags.includes(tag));
					toggle.onChange(this.createToggleHandler(activeFile, tag));
				});

			this.settings.push(setting);
		});
	}

	private createToggleHandler(file: TFile, tag: string) {
		return async (value: boolean) => {
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				let tags = frontmatter.tags || [];
				if (value && !tags.includes(tag)) {
					tags.push(tag);
				} else if (!value && tags.includes(tag)) {
					tags = tags.filter((t: string) => t !== tag);
				}
				frontmatter.tags = tags;
			});
		};
	}
}
