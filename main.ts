import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, ItemView, ToggleComponent, TFile } from 'obsidian';
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
			id: 'kikijiki-habit-tracker-open',
			name: 'Open Kikijiki Habit Tracker',
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
		this.app.workspace.detachLeavesOfType(HABIT_TRACKER_VIEW_TYPE);
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
		.setName('Tag Prefix')
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
			button.setButtonText('Add Habit');
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
		return 'Habit Tracker';
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

		const fileContent = await this.app.vault.read(activeFile);
		const yamlHeader = this.extractYamlHeader(fileContent);
		const existingTags = yamlHeader.tags || [];

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
			const content = await this.app.vault.read(file);
			const yamlHeader = this.extractYamlHeader(content);
			const currentTags = yamlHeader.tags || [];

			const updatedTags = value
				? [...new Set([...currentTags, tag])]
				: currentTags.filter((t: string) => t !== tag);

			const newYamlHeader = { ...yamlHeader, tags: updatedTags };
			const newContent = this.updateYamlHeader(content, newYamlHeader);
			await this.app.vault.modify(file, newContent);
		};
	}

	extractYamlHeader(content: string): any {
		const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
		if (yamlMatch) {
			return yaml.load(yamlMatch[1]);
		}
		return {};
	}

	updateYamlHeader(content: string, yamlHeader: any): string {
		let yamlContent: string;
		try {
			yamlContent = yaml.dump(yamlHeader);
		} catch (error) {
			console.error('Failed to dump YAML content:', error);
			return content; // Return original content if dumping fails
		}

		if (content.startsWith('---\n')) {
			return content.replace(/^---\n([\s\S]*?)\n---/, `---\n${yamlContent}\n---`);
		} else {
			return `---\n${yamlContent}\n---\n${content}`;
		}
	}
}
