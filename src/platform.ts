//src/platform.ts
import { readFile, writeFile } from 'node:fs/promises';

import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

import { MonsterApi } from './monster-api.js';
import { MonsterLightAccessory } from './monster-light-accessory.js';
import { MonsterSceneAccessory } from './monster-scene-accessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

type MonsterSceneCategory = 'static' | 'dynamic' | 'custom' | 'diy' | 'music';

interface MonsterScenePreset {
	slot: number;
	name: string;
}

interface MonsterDiscoveredSceneConfig {
	id: string;
	name: string;
}

type MonsterHiddenScenesConfig = Partial<Record<MonsterSceneCategory, string[]>>;
type MonsterDiscoveredScenesConfig = Partial<Record<MonsterSceneCategory, MonsterDiscoveredSceneConfig[]>>;

interface MonsterPlatformConfig extends PlatformConfig {
	email?: string;
	password?: string;
	pollIntervalSeconds?: number;
	sceneCategories?: {
		static?: boolean;
		dynamic?: boolean;
		custom?: boolean;
		diy?: boolean;
		music?: boolean;
	};
	hiddenScenes?: MonsterHiddenScenesConfig;
	discoveredScenes?: MonsterDiscoveredScenesConfig;
	debug?: boolean;
}

export class MonsterSmartLighting implements DynamicPlatformPlugin {
	public readonly Service: typeof Service;
	public readonly Characteristic: typeof Characteristic;

	public readonly accessories: Map<string, PlatformAccessory> = new Map();
	public readonly discoveredCacheUUIDs: string[] = [];

	private readonly monsterApi: MonsterApi | null = null;
	
	public readonly sceneAccessories: Map<string, MonsterSceneAccessory[]> = new Map();
	
	public registerSceneAccessory(dsn: string, sceneAccessory: MonsterSceneAccessory): void {
		const existing = this.sceneAccessories.get(dsn) ?? [];
		existing.push(sceneAccessory);
		this.sceneAccessories.set(dsn, existing);
	}
	
	public async refreshSceneStates(dsn: string): Promise<void> {
		const sceneAccessories = this.sceneAccessories.get(dsn) ?? [];
	
		await Promise.all(
			sceneAccessories.map((sceneAccessory) => sceneAccessory.refreshState()),
		);
	}
	
	constructor(
		public readonly log: Logging,
		public readonly config: MonsterPlatformConfig,
		public readonly api: API,
	) {
		this.Service = api.hap.Service;
		this.Characteristic = api.hap.Characteristic;

		const email = String(this.config.email ?? '').trim();
		const password = String(this.config.password ?? '').trim();
		
		if (email && password) {
			this.log.debug('Monster Smart Lighting credentials found.');
			this.monsterApi = new MonsterApi(this.log, {
				email,
				password,
			});
		} else {
			this.log.warn('Monster Smart Lighting email/password are not configured. No devices will be discovered.');
		}
		
		const sceneCategories = {
			static: this.config.sceneCategories?.static ?? false,
			dynamic: this.config.sceneCategories?.dynamic ?? false,
			custom: this.config.sceneCategories?.custom ?? false,
			diy: this.config.sceneCategories?.diy ?? false,
			music: this.config.sceneCategories?.music ?? false,
		};
		
		this.log.debug(
			'Scene accessory categories: static=%s dynamic=%s custom=%s diy=%s music=%s',
			sceneCategories.static,
			sceneCategories.dynamic,
			sceneCategories.custom,
			sceneCategories.diy,
			sceneCategories.music,
		);
		
		this.log.info('Finished initializing platform:', this.config.name);

		this.api.on('didFinishLaunching', () => {
			this.log.debug('Homebridge finished launching; starting device discovery.');
			void this.discoverDevices();
		});
	}

	configureAccessory(accessory: PlatformAccessory): void {
		this.log.info('Loading accessory from cache:', accessory.displayName);
		this.accessories.set(accessory.UUID, accessory);
	}

	private getSceneConfigId(dsn: string, category: MonsterSceneCategory, slot: number): string {
		return `${dsn}:${category}:${slot}`;
	}

	private isSceneHidden(dsn: string, category: MonsterSceneCategory, slot: number): boolean {
		const sceneId = this.getSceneConfigId(dsn, category, slot);
		return this.config.hiddenScenes?.[category]?.includes(sceneId) ?? false;
	}

	private resetDiscoveredScenes(): void {
		this.config.discoveredScenes = {
			static: [],
			dynamic: [],
			custom: [],
			diy: [],
			music: [],
		};
	}

	private cacheDiscoveredScenes(
		deviceName: string,
		dsn: string,
		category: MonsterSceneCategory,
		presets: MonsterScenePreset[],
	): void {
		this.config.discoveredScenes ??= {};
		this.config.discoveredScenes[category] ??= [];

		const discoveredScenes = this.config.discoveredScenes[category] ?? [];

		discoveredScenes.push(
			...presets.map((preset) => ({
				id: this.getSceneConfigId(dsn, category, preset.slot),
				name: `${deviceName} ${preset.name}`,
			})),
		);

		this.config.discoveredScenes[category] = discoveredScenes
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	private async persistDiscoveredScenes(): Promise<void> {
		const configPath = this.api.user.configPath();
		const rawConfig = await readFile(configPath, 'utf8');
		const homebridgeConfig = JSON.parse(rawConfig) as {
			platforms?: Array<Record<string, unknown>>;
		};

		const platformConfig = homebridgeConfig.platforms?.find((platform) => (
			platform.platform === PLATFORM_NAME || platform.platform === this.config.platform
		));

		if (!platformConfig) {
			this.log.warn('Could not persist discovered scenes because the platform config was not found.');
			return;
		}

		const nextDiscoveredScenes = this.config.discoveredScenes ?? {};
		const previousDiscoveredScenes = platformConfig.discoveredScenes ?? {};

		if (JSON.stringify(previousDiscoveredScenes) === JSON.stringify(nextDiscoveredScenes)) {
			return;
		}

		platformConfig.discoveredScenes = nextDiscoveredScenes;

		await writeFile(
			configPath,
			`${JSON.stringify(homebridgeConfig, null, '\t')}\n`,
			'utf8',
		);

		this.log.info('Updated cached discovered scene list for the custom UI.');
	}

	private registerSceneAccessories(
		device: { dsn: string; productName: string },
		category: MonsterSceneCategory,
		presets: MonsterScenePreset[],
	): void {
		this.cacheDiscoveredScenes(device.productName, device.dsn, category, presets);

		for (const preset of presets) {
			const sceneUuid = this.api.hap.uuid.generate(
				`${device.dsn}-${category}-${preset.slot}`,
			);

			this.discoveredCacheUUIDs.push(sceneUuid);

			const existingSceneAccessory = this.accessories.get(sceneUuid);
			
			if (this.isSceneHidden(device.dsn, category, preset.slot)) {
				if (existingSceneAccessory) {
					this.removeCachedAccessory(existingSceneAccessory);
					this.accessories.delete(existingSceneAccessory.UUID);
				}
			
				this.log.info(
					'Skipping hidden scene accessory: %s %s',
					device.productName,
					preset.name,
				);
			
				continue;
			}

			const sceneName = `${device.productName} ${preset.name}`;
			
			if (existingSceneAccessory) {
				this.log.info(
					'Restoring existing scene accessory from cache:',
					existingSceneAccessory.displayName,
				);

				existingSceneAccessory.context.device = device;
				existingSceneAccessory.context.preset = preset;

				this.api.updatePlatformAccessories([
					existingSceneAccessory,
				]);

				new MonsterSceneAccessory(
					this,
					existingSceneAccessory,
					this.monsterApi!,
					device.dsn,
					category,
					preset.slot,
					sceneName,
				);
			} else {
				this.log.info(
					'Adding new scene accessory:',
					sceneName,
				);

				const sceneAccessory =
					new this.api.platformAccessory(
						sceneName,
						sceneUuid,
					);

				sceneAccessory.context.device = device;
				sceneAccessory.context.preset = preset;

				new MonsterSceneAccessory(
					this,
					sceneAccessory,
					this.monsterApi!,
					device.dsn,
					category,
					preset.slot,
					sceneName,
				);

				this.api.registerPlatformAccessories(
					PLUGIN_NAME,
					PLATFORM_NAME,
					[sceneAccessory],
				);
			}
		}
	}
	
	private removeCachedAccessory(accessory: PlatformAccessory): void {
		this.log.info('Removing hidden scene accessory from cache: %s', accessory.displayName);
	
		this.api.unregisterPlatformAccessories(
			PLUGIN_NAME,
			PLATFORM_NAME,
			[accessory],
		);
	
		this.accessories.delete(accessory.UUID);
	}
	
	private async discoverDevices(): Promise<void> {
		if (!this.monsterApi) {
			return;
		}

		try {
			this.log.info('Discovering Monster Smart Lighting devices...');
			this.resetDiscoveredScenes();
			
			const devices = await this.monsterApi.getDevices();
			
			this.log.info('Discovered %d Monster Smart Lighting device(s).', devices.length);
			
			for (const device of devices) {
				const uuid = this.api.hap.uuid.generate(device.dsn);
				const existingAccessory = this.accessories.get(uuid);
													
				if (existingAccessory) {
					this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

					existingAccessory.context.device = device;
					this.api.updatePlatformAccessories([existingAccessory]);

					new MonsterLightAccessory(this, existingAccessory, this.monsterApi);
				} else {
					this.log.info('Adding new accessory:', device.productName);

					const accessory = new this.api.platformAccessory(device.productName, uuid);
					accessory.context.device = device;

					new MonsterLightAccessory(this, accessory, this.monsterApi);

					this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
				}
				
				const scenesEnabled = Object.values(this.config.sceneCategories ?? {}).some(Boolean);
				
				if (scenesEnabled) {
					const activeSceneState = await this.monsterApi.getActiveSceneState(device.dsn);
				
					this.log.info(
						'Active scene state for %s: mode=%s static=%s dynamic=%s diy=%s music=%s custom=%s',
						device.productName,
						activeSceneState.mode,
						activeSceneState.staticSlot ?? 'none',
						activeSceneState.dynamicSlot ?? 'none',
						activeSceneState.diySlot ?? 'none',
						activeSceneState.musicSlot ?? 'none',
						activeSceneState.customSlot ?? 'none',
					);
				}
				
				if (this.config.sceneCategories?.diy) {
					const diyPresets = await this.monsterApi.getDiyPresets(device.dsn);
					this.registerSceneAccessories(device, 'diy', diyPresets);
				}
				
				if (this.config.sceneCategories?.dynamic) {
					const dynamicPresets = await this.monsterApi.getDynamicPresets(device.dsn);
					this.registerSceneAccessories(device, 'dynamic', dynamicPresets);
				}
				
				if (this.config.sceneCategories?.music) {
					const musicPresets = await this.monsterApi.getMusicPresets(device.dsn);
					this.registerSceneAccessories(device, 'music', musicPresets);
				}
				
				if (this.config.sceneCategories?.static) {
					const staticPresets = await this.monsterApi.getStaticPresets(device.dsn);
					this.registerSceneAccessories(device, 'static', staticPresets);
				}
				
				if (this.config.sceneCategories?.custom) {
					const customPresets = await this.monsterApi.getCustomPresets(device.dsn);
					this.registerSceneAccessories(device, 'custom', customPresets);
				}
				
				this.discoveredCacheUUIDs.push(uuid);
			}

			await this.persistDiscoveredScenes();

			for (const [uuid, accessory] of this.accessories) {
				if (!this.discoveredCacheUUIDs.includes(uuid)) {
					this.log.info('Removing existing accessory from cache:', accessory.displayName);
					this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
				}
			}
		} catch (error) {
			this.log.error('Failed to discover Monster Smart Lighting devices:', error);
		}
	}
}
