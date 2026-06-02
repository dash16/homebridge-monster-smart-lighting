//src/monster-light-accessory.ts
import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { MonsterApi, MonsterDevice, MonsterProperty } from './monster-api.js';
import type { MonsterSmartLighting } from './platform.js';

interface MonsterLightState {
	On: boolean;
	Brightness: number;
	Hue: number;
	Saturation: number;
	ColorTemperature: number;
}

const MONSTER_COLOR_TEMP_MIN = 2;
const MONSTER_COLOR_TEMP_MAX = 100;

const HOMEKIT_MIRED_MIN = 140;
const HOMEKIT_MIRED_MAX = 500;

const DEFAULT_POLL_INTERVAL_MS = 300_000;
const MIN_POLL_INTERVAL_MS = 60_000;

export class MonsterLightAccessory {
	private service: Service;

	private state: MonsterLightState = {
		On: false,
		Brightness: 100,
		Hue: 0,
		Saturation: 100,
		ColorTemperature: HOMEKIT_MIRED_MIN,
	};
	private pollTimer: NodeJS.Timeout | null = null;
	private isRefreshing = false;
	private isSyncingFromCloud = false;
	private readonly device: MonsterDevice;
	private getFirmwareRevision(swVersion?: string | null): string {
		const match = swVersion?.match(/\b\d+\.\d+\.\d+\b/u);
	
		return match?.[0] ?? '0.0.0';
	}
	private getPollIntervalMs(): number {
		const configuredSeconds = Number(this.platform.config.pollIntervalSeconds ?? 0);
	
		if (!Number.isFinite(configuredSeconds) || configuredSeconds <= 0) {
			return DEFAULT_POLL_INTERVAL_MS;
		}
	
		return Math.max(MIN_POLL_INTERVAL_MS, configuredSeconds * 1000);
	}
	
	constructor(
		private readonly platform: MonsterSmartLighting,
		private readonly accessory: PlatformAccessory,
		private readonly monsterApi: MonsterApi,
	) {
		this.device = accessory.context.device as MonsterDevice;

		this.accessory.getService(this.platform.Service.AccessoryInformation)!
		  .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Monster Smart Lighting')
		  .setCharacteristic(this.platform.Characteristic.Model, this.device.model)
		  .setCharacteristic(this.platform.Characteristic.SerialNumber, this.device.dsn)
		  .setCharacteristic(
		  	this.platform.Characteristic.FirmwareRevision,
		  	this.getFirmwareRevision(this.device.swVersion),
		  );

		this.service = this.accessory.getService(this.platform.Service.Lightbulb)
			|| this.accessory.addService(this.platform.Service.Lightbulb);

		this.service.setCharacteristic(this.platform.Characteristic.Name, this.device.productName);

		this.service.getCharacteristic(this.platform.Characteristic.On)
		  .onSet(this.setOn.bind(this))
		  .onGet(this.getOn.bind(this));

		this.service.getCharacteristic(this.platform.Characteristic.Brightness)
		  .onSet(this.setBrightness.bind(this))
		  .onGet(this.getBrightness.bind(this));

		this.service.getCharacteristic(this.platform.Characteristic.Hue)
		  .onSet(this.setHue.bind(this))
		  .onGet(this.getHue.bind(this));

		this.service.getCharacteristic(this.platform.Characteristic.Saturation)
		  .onSet(this.setSaturation.bind(this))
		  .onGet(this.getSaturation.bind(this));

		this.service.getCharacteristic(this.platform.Characteristic.ColorTemperature)
		  .setProps({
		    minValue: HOMEKIT_MIRED_MIN,
		    maxValue: HOMEKIT_MIRED_MAX,
		  })
		  .onSet(this.setColorTemperature.bind(this))
		  .onGet(this.getColorTemperature.bind(this));

		void this.refreshState();
		this.startPolling();
	}
	// State Polling Starter: Keeps HomeKit aligned with Monster app/cloud-side changes
	private startPolling(): void {
		if (this.pollTimer) {
			return;
		}
		
		const pollIntervalMs = this.getPollIntervalMs();
		
		this.platform.log.debug(
			'Polling %s cloud state every %d seconds.',
			this.device.productName,
			Math.round(pollIntervalMs / 1000),
		);
		
		this.pollTimer = setInterval(() => {
			void this.refreshState();
		}, pollIntervalMs);
		
		this.pollTimer.unref();
	}
	
	// Cloud State Refresh: Reads Monster cloud properties and updates HomeKit characteristics
	private async refreshState(): Promise<void> {
		if (this.isRefreshing) {
			return;
		}
	
		this.isRefreshing = true;
	
		try {
			const properties = await this.monsterApi.getLightStateProperties(this.device.dsn);
	
			const nextOn = this.getBooleanProperty(properties, 'power', this.state.On);
			const nextBrightness = this.getNumberProperty(properties, 'color_bright', this.state.Brightness);
			const nextSaturation = this.getNumberProperty(properties, 'color_saturation', this.state.Saturation);
	
			const rgbValue = this.getNumberProperty(properties, 'color_select', 0);
			const hsv = this.rgbIntToHsv(rgbValue);
	
			const monsterColorTemp = this.getNumberProperty(properties, 'color_temp', MONSTER_COLOR_TEMP_MAX);
			const nextColorTemperature = this.monsterTempToHomeKitMired(monsterColorTemp);
	
			this.state.On = nextOn;
			this.state.Brightness = nextBrightness;
			this.state.Hue = hsv.hue;
			this.state.Saturation = nextSaturation;
			this.state.ColorTemperature = nextColorTemperature;
			
			this.isSyncingFromCloud = true;
			
			try {
				this.service.setCharacteristic(this.platform.Characteristic.On, nextOn);
				this.service.setCharacteristic(this.platform.Characteristic.Brightness, nextBrightness);
				this.service.setCharacteristic(this.platform.Characteristic.Hue, hsv.hue);
				this.service.setCharacteristic(this.platform.Characteristic.Saturation, nextSaturation);
				this.service.setCharacteristic(this.platform.Characteristic.ColorTemperature, nextColorTemperature);
			} finally {
				this.isSyncingFromCloud = false;
			}
		} catch (error) {
			this.platform.log.warn(`Failed to refresh state for ${this.device.productName}:`, error);
		} finally {
			this.isRefreshing = false;
		}
	}

	private async setOn(value: CharacteristicValue): Promise<void> {
		if (this.isSyncingFromCloud) {
			return;
		}
		const on = Boolean(value);

		await this.monsterApi.setProperty(this.device.dsn, 'power', on ? 1 : 0);
		this.state.On = on;

		this.platform.log.info(
			'Setting %s power %s',
			this.device.productName,
			on ? 'on' : 'off',
		);
	}

	private async getOn(): Promise<CharacteristicValue> {
		return this.state.On;
	}

	private async setBrightness(value: CharacteristicValue): Promise<void> {
		if (this.isSyncingFromCloud) {
			return;
		}
		const brightness = Number(value);
	
		this.state.Brightness = brightness;
	
		await this.monsterApi.setProperty(this.device.dsn, 'color_bright', brightness);
		await this.monsterApi.setProperty(this.device.dsn, 'brightness', brightness);
	
		this.platform.log.info(
			'Setting %s brightness to %d%%',
			this.device.productName,
			brightness,
		);
	}

	private async getBrightness(): Promise<CharacteristicValue> {
		return this.state.Brightness;
	}

	private async setHue(value: CharacteristicValue): Promise<void> {
		if (this.isSyncingFromCloud) {
			return;
		}
		const hue = Number(value);

		this.state.Hue = hue;
		await this.setRgbColorFromState();

		this.platform.log.debug(`Set ${this.device.productName} Hue ->`, hue);
	}

	private async getHue(): Promise<CharacteristicValue> {
		return this.state.Hue;
	}

	private async setSaturation(value: CharacteristicValue): Promise<void> {
		if (this.isSyncingFromCloud) {
			return;
		}
		const saturation = Number(value);

		this.state.Saturation = saturation;

		await this.monsterApi.setProperty(this.device.dsn, 'color_saturation', saturation);
		await this.setRgbColorFromState();

		this.platform.log.debug(`Set ${this.device.productName} Saturation ->`, saturation);
	}

	private async getSaturation(): Promise<CharacteristicValue> {
		return this.state.Saturation;
	}

	private async setColorTemperature(value: CharacteristicValue): Promise<void> {
		if (this.isSyncingFromCloud) {
			return;
		}
		const homeKitMired = Number(value);
		const monsterTemp = this.homeKitMiredToMonsterTemp(homeKitMired);
	
		await this.monsterApi.setProperty(this.device.dsn, 'mode', 'white');
		await this.monsterApi.setProperty(this.device.dsn, 'color_temp', monsterTemp);
	
		this.state.ColorTemperature = homeKitMired;
	
		this.platform.log.info(
			'Setting %s color temperature to %d mired',
			this.device.productName,
			homeKitMired,
		);
	}

	private async getColorTemperature(): Promise<CharacteristicValue> {
		return this.state.ColorTemperature;
	}

	private async setRgbColorFromState(): Promise<void> {
		const rgbInt = this.hsvToRgbInt(this.state.Hue, this.state.Saturation, this.state.Brightness);
		
		this.platform.log.info(
			'Setting %s color (H:%d S:%d)',
			this.device.productName,
			this.state.Hue,
			this.state.Saturation,
		);
		
		await this.monsterApi.setProperty(this.device.dsn, 'mode', 'color');
		await this.monsterApi.setProperty(this.device.dsn, 'color_select', rgbInt);
	}

	private getNumberProperty(properties: MonsterProperty[], name: string, fallback: number): number {
		const property = properties.find((item) => item.name === name);

		if (typeof property?.value === 'number') {
			return property.value;
		}

		return fallback;
	}

	private getBooleanProperty(properties: MonsterProperty[], name: string, fallback: boolean): boolean {
		const property = properties.find((item) => item.name === name);

		if (typeof property?.value === 'boolean') {
			return property.value;
		}

		if (typeof property?.value === 'number') {
			return property.value !== 0;
		}

		return fallback;
	}

	private hsvToRgbInt(hue: number, saturation: number, brightness: number): number {
		const s = saturation / 100;
		const v = brightness / 100;
		const c = v * s;
		const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
		const m = v - c;

		let r = 0;
		let g = 0;
		let b = 0;

		if (hue < 60) {
			r = c;
			g = x;
		} else if (hue < 120) {
			r = x;
			g = c;
		} else if (hue < 180) {
			g = c;
			b = x;
		} else if (hue < 240) {
			g = x;
			b = c;
		} else if (hue < 300) {
			r = x;
			b = c;
		} else {
			r = c;
			b = x;
		}

		const red = Math.round((r + m) * 255);
		const green = Math.round((g + m) * 255);
		const blue = Math.round((b + m) * 255);

		return (red << 16) | (green << 8) | blue;
	}

	private rgbIntToHsv(rgbInt: number): { hue: number; saturation: number } {
		const red = ((rgbInt >> 16) & 0xff) / 255;
		const green = ((rgbInt >> 8) & 0xff) / 255;
		const blue = (rgbInt & 0xff) / 255;

		const max = Math.max(red, green, blue);
		const min = Math.min(red, green, blue);
		const delta = max - min;

		let hue = 0;

		if (delta !== 0) {
			if (max === red) {
				hue = 60 * (((green - blue) / delta) % 6);
			} else if (max === green) {
				hue = 60 * (((blue - red) / delta) + 2);
			} else {
				hue = 60 * (((red - green) / delta) + 4);
			}
		}

		if (hue < 0) {
			hue += 360;
		}

		const saturation = max === 0 ? 0 : (delta / max) * 100;

		return {
			hue: Math.round(hue),
			saturation: Math.round(saturation),
		};
	}

	private homeKitMiredToMonsterTemp(homeKitMired: number): number {
		const clampedMired = Math.max(HOMEKIT_MIRED_MIN, Math.min(HOMEKIT_MIRED_MAX, homeKitMired));
		const normalized = (clampedMired - HOMEKIT_MIRED_MIN) / (HOMEKIT_MIRED_MAX - HOMEKIT_MIRED_MIN);
		const monsterTemp = MONSTER_COLOR_TEMP_MAX - Math.round(normalized * (MONSTER_COLOR_TEMP_MAX - MONSTER_COLOR_TEMP_MIN));

		return Math.max(MONSTER_COLOR_TEMP_MIN, Math.min(MONSTER_COLOR_TEMP_MAX, monsterTemp));
	}

	private monsterTempToHomeKitMired(monsterTemp: number): number {
		const clampedTemp = Math.max(MONSTER_COLOR_TEMP_MIN, Math.min(MONSTER_COLOR_TEMP_MAX, monsterTemp));
		const normalized = (MONSTER_COLOR_TEMP_MAX - clampedTemp) / (MONSTER_COLOR_TEMP_MAX - MONSTER_COLOR_TEMP_MIN);

		return HOMEKIT_MIRED_MIN + Math.round(normalized * (HOMEKIT_MIRED_MAX - HOMEKIT_MIRED_MIN));
	}
}