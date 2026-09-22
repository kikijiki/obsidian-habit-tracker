import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, ItemView, TFile, setIcon } from 'obsidian';

const HABIT_TRACKER_VIEW_TYPE = 'kikijiki-habit-tracker-view';

interface KikijikiHabitTrackerSettings {
	tagPrefix: string;
	habits: string[];
	multiColumnLayout: boolean;
}

const DEFAULT_SETTINGS: KikijikiHabitTrackerSettings = {
	tagPrefix: 'habit',
	habits: [],
	multiColumnLayout: false,
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
				void this.activateView();
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
			await rightLeaf.setViewState({
				type: HABIT_TRACKER_VIEW_TYPE,
				active: true,
			});
			await this.app.workspace.revealLeaf(rightLeaf);
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

	refreshViews(): void {
		this.app.workspace
			.getLeavesOfType(HABIT_TRACKER_VIEW_TYPE)
			.forEach(leaf => (leaf.view as HabitTrackerView).refresh());
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
					this.plugin.refreshViews();
				}));

		new Setting(containerEl)
			.setName('Multi-column panel')
			.setDesc('Show habits in equal-width columns when the panel has enough space.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.multiColumnLayout)
				.onChange(async (value) => {
					this.plugin.settings.multiColumnLayout = value;
					await this.plugin.saveSettings();
					this.plugin.refreshViews();
				}));

		new Setting(containerEl)
			.setName('List of all habits')
			.setHeading()
			.setClass('kikijiki-habit-list-heading')
			.addButton(button => {
				button
					.setIcon('plus')
					.setTooltip('Add habit')
					.onClick(async () => {
						this.plugin.settings.habits.push('');
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
						this.display();
					});
			});

		const habitList = containerEl.createDiv({ cls: 'kikijiki-habit-list' });
		this.plugin.settings.habits.forEach((habit, index) => {
			this.renderHabitRow(habitList, habit, index);
		});

	}

	private renderHabitRow(container: HTMLElement, habit: string, index: number): void {
		const row = container.createDiv({ cls: 'kikijiki-habit-row' });
		row.dataset.index = index.toString();

		const dragHandle = row.createEl('button', {
			cls: 'clickable-icon kikijiki-habit-row__icon kikijiki-habit-row__handle',
			attr: {
				type: 'button',
				'aria-label': `Reorder habit ${(index + 1).toString()}`,
				'aria-grabbed': 'false',
			},
		});
		setIcon(dragHandle, 'grip-vertical');
		dragHandle.setAttribute('title', 'Drag to reorder');

		const input = row.createEl('input', {
			cls: 'kikijiki-habit-row__input',
			attr: {
				type: 'text',
				placeholder: 'Enter habit name',
				value: habit,
				'aria-label': `Habit ${(index + 1).toString()}`,
			},
		});
		input.addEventListener('input', () => {
			void this.updateHabitName(index, input.value);
		});

		const removeButton = row.createEl('button', {
			cls: 'clickable-icon kikijiki-habit-row__icon kikijiki-habit-row__remove',
			attr: {
				type: 'button',
				'aria-label': `Remove habit ${(index + 1).toString()}`,
				title: 'Remove habit',
			},
		});
		setIcon(removeButton, 'trash');
		removeButton.addEventListener('click', () => {
			void this.removeHabit(index);
		});

		this.registerDragHandle(dragHandle, row, container, index);
	}

	private registerDragHandle(
		handle: HTMLButtonElement,
		row: HTMLElement,
		container: HTMLElement,
		fromIndex: number,
	): void {
		let activePointer: number | null = null;
		let targetIndex = fromIndex;

		const clearTarget = (): void => {
			container
				.querySelectorAll('.kikijiki-habit-row.is-drop-target')
				.forEach(candidate => candidate.removeClass('is-drop-target'));
		};

		const finish = (move: boolean): void => {
			if (activePointer === null) {
				return;
			}
			if (handle.hasPointerCapture(activePointer)) {
				handle.releasePointerCapture(activePointer);
			}
			activePointer = null;
			handle.setAttribute('aria-grabbed', 'false');
			row.removeClass('is-dragging');
			clearTarget();
			if (move && targetIndex !== fromIndex) {
				void this.moveHabit(fromIndex, targetIndex);
			}
		};

		handle.addEventListener('pointerdown', event => {
			if (event.button !== 0 || activePointer !== null) {
				return;
			}
			activePointer = event.pointerId;
			targetIndex = fromIndex;
			handle.setPointerCapture(event.pointerId);
			handle.setAttribute('aria-grabbed', 'true');
			row.addClass('is-dragging');
		});

		handle.addEventListener('pointermove', event => {
			if (event.pointerId !== activePointer) {
				return;
			}
			const rows = Array.from(
				container.querySelectorAll<HTMLElement>('.kikijiki-habit-row'),
			);
			const nearest = rows.reduce<{ row: HTMLElement; distance: number } | null>(
				(closest, candidate) => {
					const bounds = candidate.getBoundingClientRect();
					const distance = Math.abs(event.clientY - (bounds.top + bounds.height / 2));
					return closest === null || distance < closest.distance
						? { row: candidate, distance }
						: closest;
				},
				null,
			);
			const nextIndex = Number.parseInt(nearest?.row.dataset.index ?? '', 10);
			if (!Number.isInteger(nextIndex)) {
				return;
			}
			targetIndex = nextIndex;
			clearTarget();
			if (targetIndex !== fromIndex) {
				nearest?.row.addClass('is-drop-target');
			}
		});

		handle.addEventListener('pointerup', event => {
			if (event.pointerId === activePointer) {
				finish(true);
			}
		});
		handle.addEventListener('pointercancel', () => finish(false));
	}

	private async moveHabit(fromIndex: number, toIndex: number): Promise<void> {
		const habits = this.plugin.settings.habits;
		const destination = Math.max(0, Math.min(toIndex, habits.length - 1));
		if (fromIndex === destination) {
			return;
		}
		const [habit] = habits.splice(fromIndex, 1);
		if (habit === undefined) {
			return;
		}
		habits.splice(destination, 0, habit);
		await this.plugin.saveSettings();
		this.plugin.refreshViews();
		this.display();
	}

	private async updateHabitName(index: number, value: string): Promise<void> {
		this.plugin.settings.habits[index] = value.trim();
		await this.plugin.saveSettings();
		this.plugin.refreshViews();
	}

	private async removeHabit(index: number): Promise<void> {
		this.plugin.settings.habits.splice(index, 1);
		await this.plugin.saveSettings();
		this.plugin.refreshViews();
		this.display();
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

	refresh(): void {
		this.currentFile = null;
		this.render();
	}

	render() {
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
		const habitGrid = contentEl.createDiv({ cls: 'kikijiki-habit-panel-grid' });
		if (this.plugin.settings.multiColumnLayout) {
			habitGrid.addClass('is-multi-column');
		}

		this.plugin.settings.habits.forEach(habit => {
			if (!habit || habit.trim() === '') {
				return;
			}

			const tag = `${this.plugin.settings.tagPrefix}/${habit}`;
			const setting = new Setting(habitGrid)
				.setClass('kikijiki-habit-panel-item')
				.setName(habit)
				.addToggle(toggle => {
					toggle.setValue(existingTags.includes(tag));
					toggle.onChange(this.createToggleHandler(activeFile, tag));
				});

			this.settings.push(setting);
		});

		if (!this.plugin.settings.multiColumnLayout) {
			return;
		}

		window.requestAnimationFrame(() => {
			if (!habitGrid.isConnected) {
				return;
			}
			const widths = this.settings.map(setting => {
				const el = setting.settingEl;
				const prevWidth = el.style.width;
				const prevMinWidth = el.style.minWidth;
				el.style.width = 'max-content';
				el.style.minWidth = '0';
				const width = el.getBoundingClientRect().width;
				el.style.width = prevWidth;
				el.style.minWidth = prevMinWidth;
				return width;
			});
			const widestItem = widths.length > 0 ? Math.max(...widths) : 0;
			if (widestItem <= 0) {
				return;
			}
			habitGrid.style.setProperty(
				'--kikijiki-habit-panel-column-min',
				`${Math.ceil(widestItem).toString()}px`,
			);
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
