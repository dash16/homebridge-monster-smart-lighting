//src/platform.ts
import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

import { MonsterApi } from './monster-api.js';
import { MonsterLightAccessory } from './monster-light-accessory.js';
import { MonsterSceneAccessory } from './monster-scene-accessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

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

	private async discoverDevices(): Promise<void> {
		if (!this.monsterApi) {
			return;
		}

		try {
			this.log.info('Discovering Monster Smart Lighting devices...');
			
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
				
					this.log.debug(
						'Active scene state for %s: mode=%s static=%s dynamic=%s diy=%s music=%s',
						device.productName,
						activeSceneState.mode,
						activeSceneState.staticSlot ?? 'none',
						activeSceneState.dynamicSlot ?? 'none',
						activeSceneState.diySlot ?? 'none',
						activeSceneState.musicSlot ?? 'none',
					);
				}
				
				if (this.config.sceneCategories?.diy) {
					const diyPresets = await this.monsterApi.getDiyPresets(device.dsn);
				
					for (const preset of diyPresets) {
						const sceneUuid = this.api.hap.uuid.generate(
							`${device.dsn}-diy-${preset.slot}`,
						);
				
						const sceneName = `${device.productName} ${preset.name}`;
				
						const existingSceneAccessory =
							this.accessories.get(sceneUuid);
				
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
								this.monsterApi,
								device.dsn,
								'diy',
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
								this.monsterApi,
								device.dsn,
								'diy',
								preset.slot,
								sceneName,
							);
				
							this.api.registerPlatformAccessories(
								PLUGIN_NAME,
								PLATFORM_NAME,
								[sceneAccessory],
							);
						}
				
						this.discoveredCacheUUIDs.push(sceneUuid);
					}
				}
				
				if (this.config.sceneCategories?.dynamic) {
					const dynamicPresets = await this.monsterApi.getDynamicPresets(device.dsn);
				
					for (const preset of dynamicPresets) {
						const sceneUuid = this.api.hap.uuid.generate(
							`${device.dsn}-dynamic-${preset.slot}`,
						);
				
						const sceneName = `${device.productName} ${preset.name}`;
				
						const existingSceneAccessory =
							this.accessories.get(sceneUuid);
				
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
								this.monsterApi,
								device.dsn,
								'dynamic',
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
								this.monsterApi,
								device.dsn,
								'dynamic',
								preset.slot,
								sceneName,
							);
				
							this.api.registerPlatformAccessories(
								PLUGIN_NAME,
								PLATFORM_NAME,
								[sceneAccessory],
							);
						}
				
						this.discoveredCacheUUIDs.push(sceneUuid);
					}
				}
				
				if (this.config.sceneCategories?.music) {
					const musicPresets = await this.monsterApi.getMusicPresets(device.dsn);
				
					for (const preset of musicPresets) {
						const sceneUuid = this.api.hap.uuid.generate(
							`${device.dsn}-music-${preset.slot}`,
						);
				
						const sceneName = `${device.productName} ${preset.name}`;
				
						const existingSceneAccessory =
							this.accessories.get(sceneUuid);
				
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
								this.monsterApi,
								device.dsn,
								'music',
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
								this.monsterApi,
								device.dsn,
								'music',
								preset.slot,
								sceneName,
							);
				
							this.api.registerPlatformAccessories(
								PLUGIN_NAME,
								PLATFORM_NAME,
								[sceneAccessory],
							);
						}
				
						this.discoveredCacheUUIDs.push(sceneUuid);
					}
				}
				this.discoveredCacheUUIDs.push(uuid);
			}

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