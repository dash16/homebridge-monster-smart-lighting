// src/monster-scene-accessory.ts

import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { MonsterSmartLighting } from './platform.js';
import { MonsterApi, type MonsterPresetFamily } from './monster-api.js';

export class MonsterSceneAccessory {
	private service: Service;

	constructor(
		private readonly platform: MonsterSmartLighting,
		private readonly accessory: PlatformAccessory,
		private readonly monsterApi: MonsterApi,
		private readonly dsn: string,
		private readonly family: Exclude<MonsterPresetFamily, 'rgbic'>,
		private readonly slot: number,
		private readonly name: string,
	) {
		this.service =
			this.accessory.getService(this.platform.Service.Switch)
			?? this.accessory.addService(
				this.platform.Service.Switch,
				this.name,
			);

		this.service.setCharacteristic(
			this.platform.Characteristic.Name,
			this.name,
		);

		this.service
			.getCharacteristic(this.platform.Characteristic.On)
			.onSet(this.handleOnSet.bind(this))
			.onGet(this.handleOnGet.bind(this));
		
		this.platform.registerSceneAccessory(this.dsn, this);
	}

	private async handleOnSet(value: CharacteristicValue): Promise<void> {
		if (value) {
			await this.monsterApi.setProperty(this.dsn, 'power', 1);
	
			await this.monsterApi.activatePreset(
				this.dsn,
				this.family,
				this.slot,
			);
	
			await this.platform.refreshSceneStates(this.dsn);
	
			return;
		}
	
		await this.monsterApi.setProperty(this.dsn, 'power', 0);
	
		await this.platform.refreshSceneStates(this.dsn);
	}
	
	private async handleOnGet(): Promise<boolean> {
		const power = await this.monsterApi.getProperty(this.dsn, 'power');
		const state = await this.monsterApi.getActiveSceneState(this.dsn);
	
		const powerOn = power?.value === 1 || power?.value === true;
	
		return (
			powerOn
			&& this.family === 'diy'
			&& state.mode === 'DIY'
			&& state.diySlot === this.slot
		);
	}
	
	public async refreshState(): Promise<void> {
		const active = await this.handleOnGet();
	
		this.service.updateCharacteristic(
			this.platform.Characteristic.On,
			active,
		);
	}
}

