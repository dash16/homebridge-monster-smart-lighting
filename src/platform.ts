//src/platform.ts
import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

import { MonsterApi } from './monster-api.js';
import { MonsterLightAccessory } from './monster-light-accessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

interface MonsterPlatformConfig extends PlatformConfig {
	email?: string;
	password?: string;
}

export class MonsterSmartLighting implements DynamicPlatformPlugin {
	public readonly Service: typeof Service;
	public readonly Characteristic: typeof Characteristic;

	public readonly accessories: Map<string, PlatformAccessory> = new Map();
	public readonly discoveredCacheUUIDs: string[] = [];

	private readonly monsterApi: MonsterApi | null = null;

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