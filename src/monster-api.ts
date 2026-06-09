// src/monster-api.ts
import type { Logger } from 'homebridge';
import { encodeRgbicPayload, type RgbicSwatch } from './rgbic.js';

const MONSTER_BASE_URL = 'https://api.monstergen2.bycopilot.com';

const SPHERE_BASE_URL = 'https://sphere.bycopilot.com';
const SPHERE_PARTNER_ID = '162fa71e-46d6-4cc6-9eab-db1925fdcb30';

const AYLA_USER_BASE_URL = 'https://user-field.aylanetworks.com';
const AYLA_DEVICE_BASE_URL = 'https://ads-field.aylanetworks.com';

const MONSTER_APPLICATION_ID = 'MONSTERGEN2';
const AYLA_APP_ID = 'RGBIC-yQ-id';
const AYLA_APP_SECRET = 'RGBIC-O7v7HvMh9OjQBz8eA6tL6Pprp8U';

const TOKEN_EXPIRY_BUFFER_MS = 60_000;

const MONSTER_USER_AGENT = 'Runner/2.0.157 (com.xtreme.monstersmartlighting; build:157; iOS 26.5.0) Alamofire/5.11.0';
const MONSTER_SDK_VERSION = '6.0.8';
const MONSTER_DEVICE_ID = '62B62449-4052-4075-90C9-9427F31F1F51';

export interface MonsterApiConfig {
	email: string;
	password: string;
}

export interface MonsterDevice {
	productName: string;
	model: string;
	dsn: string;
	oemModel: string | null;
	swVersion: string | null;
	lanIp: string | null;
	lanEnabled: boolean;
	connectionStatus: string | null;
	key: number;
}
export type MonsterPresetFamily = 'static' | 'dynamic' | 'diy' | 'music' | 'rgbic';

export interface MonsterPreset {
	family: MonsterPresetFamily;
	slot: number;
	propertyName: string;
	name: string;
	brightness: number;
	version: string;
	reset: boolean;
	speed?: number;
	musicSensitivity?: number;
	colors?: Array<{
		mode?: string;
		color: number;
		saturation: number;
	}>;
}

export interface RgbicPreset {
	slot: number;
	propertyName: string;
	name: string;
	brightness: number;
	version: string;
	reset: boolean;
	caB64: string;
}

export interface MonsterProperty {
	name: string;
	baseType: string;
	readOnly: boolean;
	value: string | number | boolean | null;
	key: number;
	deviceKey: number;
}

export interface MonsterActiveSceneState {
	mode: string | null;
	staticSlot?: number;
	dynamicSlot?: number;
	diySlot?: number;
	musicSlot?: number;
}

interface MonsterLoginResponse {
	tokenType: string;
	accessToken: string;
	refreshToken: string;
	expiresIn: number;
}

interface AylaTokenResponse {
	access_token: string;
	refresh_token: string;
	expires_in: number;
	role: string;
	code: string;
}

interface AylaDeviceResponse {
	device: {
		product_name: string;
		model: string;
		dsn: string;
		oem_model: string | null;
		sw_version: string | null;
		lan_ip: string | null;
		lan_enabled: boolean;
		connection_status: string | null;
		key: number;
	};
}

interface AylaPropertyResponse {
	property: {
		name: string;
		base_type: string;
		read_only: boolean;
		value: string | number | boolean | null;
		key: number;
		device_key: number;
	};
}

interface SphereTicketResponse {
	errorCode: number;
	reason: string;
	partnerTicket: string;
	uuid: string;
}

export class MonsterApi {
	private monsterAccessToken: string | null = null;
	private monsterRefreshToken: string | null = null;
	private monsterTokenExpiresAt = 0;
	private spherePartnerTicket: string | null = null;

	private aylaAccessToken: string | null = null;
	private aylaRefreshToken: string | null = null;
	private aylaTokenExpiresAt = 0;
	
	private authRecoveryPromise: Promise<void> | null = null;
	
	private readonly presetFamilies = {
		static: { prefix: 'st', maxSlot: 15, mode: 'scene', selector: 'st_pat' },
		dynamic: { prefix: 'dyn', maxSlot: 15, mode: 'dynamic', selector: 'dyn_pat' },
		diy: { prefix: 'diy', maxSlot: 15, mode: 'DIY', selector: 'diy_pat' },
		music: { prefix: 'mus', maxSlot: 5, mode: 'music', selector: 'mus_pat' },
	} as const;
	
	constructor(
		private readonly log: Logger,
		private readonly config: MonsterApiConfig,
	) {}

	public async getDevices(): Promise<MonsterDevice[]> {
		const response = await this.requestAylaJson<AylaDeviceResponse[]>(
			`${AYLA_DEVICE_BASE_URL}/apiv1/devices.json`,
			{
				method: 'GET',
			},
		);

		return response.map((item) => ({
			productName: item.device.product_name,
			model: item.device.model,
			dsn: item.device.dsn,
			oemModel: item.device.oem_model,
			swVersion: item.device.sw_version,
			lanIp: item.device.lan_ip,
			lanEnabled: item.device.lan_enabled,
			connectionStatus: item.device.connection_status,
			key: item.device.key,
		}));
	}

	public async getProperties(dsn: string): Promise<MonsterProperty[]> {
		const response = await this.requestAylaJson<AylaPropertyResponse[]>(
			`${AYLA_DEVICE_BASE_URL}/apiv1/dsns/${encodeURIComponent(dsn)}/properties.json`,
			{
				method: 'GET',
			},
		);

		return response.map((item) => ({
			name: item.property.name,
			baseType: item.property.base_type,
			readOnly: item.property.read_only,
			value: item.property.value,
			key: item.property.key,
			deviceKey: item.property.device_key,
		}));
	}
	
	public async getProperty(dsn: string, propertyName: string): Promise<MonsterProperty | null> {
		const response = await this.requestAylaJson<AylaPropertyResponse>(
			`${AYLA_DEVICE_BASE_URL}/apiv1/dsns/${encodeURIComponent(dsn)}/properties/${encodeURIComponent(propertyName)}.json`,
			{
				method: 'GET',
			},
		);
	
		if (!response?.property) {
			return null;
		}
	
		return {
			name: response.property.name,
			baseType: response.property.base_type,
			readOnly: response.property.read_only,
			value: response.property.value,
			key: response.property.key,
			deviceKey: response.property.device_key,
		};
	}
	
	public async getLightStateProperties(dsn: string): Promise<MonsterProperty[]> {
		const propertyNames = [
			'power',
			'color_bright',
			'color_saturation',
			'color_select',
			'color_temp',
		];
	
		const properties = await Promise.all(
			propertyNames.map((propertyName) => this.getProperty(dsn, propertyName)),
		);
	
		return properties.filter((property): property is MonsterProperty => property !== null);
	}
	
	public async setProperty(
		dsn: string,
		propertyName: string,
		value: string | number | boolean,
	): Promise<void> {
		await this.requestAylaJson<unknown>(
			`${AYLA_DEVICE_BASE_URL}/apiv1/dsns/${encodeURIComponent(dsn)}/properties/${encodeURIComponent(propertyName)}/datapoints.json`,
			{
				method: 'POST',
				headers: {
					'content-type': 'application/json',
				},
				body: JSON.stringify({
					datapoint: {
						value,
					},
				}),
			},
		);
	}
	
	public async getPresets(dsn: string, family: Exclude<MonsterPresetFamily, 'rgbic'>): Promise<MonsterPreset[]> {
		const properties = await this.getProperties(dsn);
		const config = this.presetFamilies[family];
	
		return properties
			.filter((property) => new RegExp(`^${config.prefix}\\d{2}$`).test(property.name))
			.map((property) => this.parsePreset(property, family))
			.filter((preset): preset is MonsterPreset => preset !== null)
			.sort((a, b) => a.slot - b.slot);
	}
	
	public async getStaticPresets(dsn: string): Promise<MonsterPreset[]> {
		return this.getPresets(dsn, 'static');
	}
	
	public async getDynamicPresets(dsn: string): Promise<MonsterPreset[]> {
		return this.getPresets(dsn, 'dynamic');
	}
	
	public async getDiyPresets(dsn: string): Promise<MonsterPreset[]> {
		return this.getPresets(dsn, 'diy');
	}
	
	public async getMusicPresets(dsn: string): Promise<MonsterPreset[]> {
		return this.getPresets(dsn, 'music');
	}
	
	public async getRgbicPresets(dsn: string): Promise<RgbicPreset[]> {
		const properties = await this.getProperties(dsn);
	
		return properties
			.filter((property) => /^pic\d{2}$/.test(property.name))
			.map((property) => this.parseRgbicPreset(property))
			.filter((preset): preset is RgbicPreset => preset !== null)
			.sort((a, b) => a.slot - b.slot);
	}
	
	public async getActiveSceneState(dsn: string): Promise<MonsterActiveSceneState> {
		const properties = await Promise.all([
			this.getProperty(dsn, 'mode'),
			this.getProperty(dsn, 'st_pat'),
			this.getProperty(dsn, 'dyn_pat'),
			this.getProperty(dsn, 'diy_pat'),
			this.getProperty(dsn, 'mus_pat'),
		]);
	
		const [mode, staticSlot, dynamicSlot, diySlot, musicSlot] = properties;
	
		return {
			mode: typeof mode?.value === 'string' ? mode.value : null,
			staticSlot: typeof staticSlot?.value === 'number' ? staticSlot.value : undefined,
			dynamicSlot: typeof dynamicSlot?.value === 'number' ? dynamicSlot.value : undefined,
			diySlot: typeof diySlot?.value === 'number' ? diySlot.value : undefined,
			musicSlot: typeof musicSlot?.value === 'number' ? musicSlot.value : undefined,
		};
	}
	
	private parsePreset(property: MonsterProperty, family: Exclude<MonsterPresetFamily, 'rgbic'>): MonsterPreset | null {
		if (typeof property.value !== 'string' || !property.value.trim()) {
			return null;
		}

		try {
			const parsed = JSON.parse(property.value) as {
			n?: unknown;
			b?: unknown;
			v?: unknown;
			reset?: unknown;
			s?: unknown;
			m?: unknown;
			ca?: unknown;
		};

			const colors = Array.isArray(parsed.ca)
				? parsed.ca
					.map((entry) => {
						if (typeof entry !== 'object' || entry === null) {
							return null;
						}
			
						const colorEntry = entry as {
							m?: unknown;
							c?: unknown;
							cs?: unknown;
						};
			
						if (typeof colorEntry.c !== 'number') {
							return null;
						}
			
						const parsedColor: {
							mode?: string;
							color: number;
							saturation: number;
						} = {
							color: colorEntry.c,
							saturation: typeof colorEntry.cs === 'number' ? colorEntry.cs : 100,
						};
			
						if (typeof colorEntry.m === 'string') {
							parsedColor.mode = colorEntry.m;
						}
			
						return parsedColor;
					})
					.filter((entry): entry is {
						mode?: string;
						color: number;
						saturation: number;
					} => entry !== null)
				: undefined;

			return {
				family,
				slot: Number(property.name.slice(this.presetFamilies[family].prefix.length)),
				propertyName: property.name,
				name: typeof parsed.n === 'string' ? parsed.n : property.name,
				brightness: typeof parsed.b === 'number' ? parsed.b : 100,
				version: typeof parsed.v === 'string' ? parsed.v : '2.0',
				reset: typeof parsed.reset === 'boolean' ? parsed.reset : false,
				speed: typeof parsed.s === 'number' ? parsed.s : undefined,
				musicSensitivity: typeof parsed.m === 'number' ? parsed.m : undefined,
				colors,
			};
		} catch {
			this.log.warn('Failed to parse preset property %s.', property.name);
			return null;
		}
	}
	
	private parseRgbicPreset(property: MonsterProperty): RgbicPreset | null {
		if (typeof property.value !== 'string' || !property.value.trim()) {
			return null;
		}
	
		try {
			const parsed = JSON.parse(property.value) as {
				n?: unknown;
				b?: unknown;
				v?: unknown;
				reset?: unknown;
				ca_b64?: unknown;
			};
	
			const slot = Number(property.name.slice(3));
	
			return {
				slot,
				propertyName: property.name,
				name: typeof parsed.n === 'string' ? parsed.n : property.name,
				brightness: typeof parsed.b === 'number' ? parsed.b : 100,
				version: typeof parsed.v === 'string' ? parsed.v : '2.1',
				reset: typeof parsed.reset === 'boolean' ? parsed.reset : false,
				caB64: typeof parsed.ca_b64 === 'string' ? parsed.ca_b64 : '',
			};
		} catch {
			this.log.warn('Failed to parse RGBIC preset property %s.', property.name);
			return null;
		}
	}
	
	public async activatePreset(
		dsn: string,
		family: Exclude<MonsterPresetFamily, 'rgbic'>,
		slot: number,
	): Promise<void> {
		const config = this.presetFamilies[family];
	
		if (!Number.isInteger(slot) || slot < 0 || slot > config.maxSlot) {
			throw new Error(`Invalid ${family} preset slot: ${slot}`);
		}
	
		this.log.info('Activating %s preset slot %d.', family, slot);
	
		await this.setProperty(dsn, 'mode', config.mode);
		await this.setProperty(dsn, config.selector, slot);
	}
	
	public async activateRgbicPreset(dsn: string, slot: number): Promise<void> {
		if (!Number.isInteger(slot) || slot < 0 || slot > 4) {
			throw new Error(`Invalid RGBIC preset slot: ${slot}`);
		}
	
		this.log.info('Activating RGBIC preset slot %d.', slot);
	
		await this.setProperty(dsn, 'mode', 'per_ic');
		await this.setProperty(dsn, 'per_ic_pat', slot);
	}
	
	public async setRgbicPreset(
		dsn: string,
		slot: number,
		name: string,
		swatches: RgbicSwatch[],
		brightness: number,
	): Promise<void> {
		if (!Number.isInteger(slot) || slot < 0 || slot > 4) {
			throw new Error(`Invalid RGBIC preset slot: ${slot}`);
		}
	
		const propertyName = `pic${slot.toString().padStart(2, '0')}`;
	
		const preset = {
			n: name,
			b: brightness,
			v: '2.1',
			reset: false,
			ca_b64: encodeRgbicPayload(swatches),
		};
	
		await this.setProperty(dsn, propertyName, JSON.stringify(preset));
		await this.activateRgbicPreset(dsn, slot);
	}
	
	private async acquireSphereTicket(): Promise<void> {
		if (!this.monsterAccessToken) {
			throw new Error('Cannot acquire Sphere partner ticket without a Monster access token.');
		}

		this.log.info('Acquiring Sphere partner ticket...');

		const response = await this.requestJson<SphereTicketResponse>(
			`${SPHERE_BASE_URL}/v2/partner/${SPHERE_PARTNER_ID}/acquire_ticket`,
			{
				method: 'POST',
				headers: {
					'accept': '*/*',
					'authorization': `Bearer ${this.monsterAccessToken}`,
					'content-type': 'application/json',
					'user-agent': MONSTER_USER_AGENT,
					'x-copilot-sdk-version': MONSTER_SDK_VERSION,
				},
				body: JSON.stringify({
					applicationId: MONSTER_APPLICATION_ID,
				}),
			},
		);

		if (!response.partnerTicket) {
			throw new Error(`Sphere partner ticket response did not include partnerTicket. Reason: ${response.reason}`);
		}

		this.spherePartnerTicket = response.partnerTicket;

		this.log.info('Sphere partner ticket acquired.');
	}

	private async ensureAylaAuth(): Promise<void> {
		const now = Date.now();

		if (this.aylaAccessToken && now < this.aylaTokenExpiresAt - TOKEN_EXPIRY_BUFFER_MS) {
			return;
		}

		await this.loginToMonster();
		await this.acquireSphereTicket();
		await this.signInToAyla();
	}

	private async loginToMonster(): Promise<void> {
		const now = Date.now();

		if (this.monsterAccessToken && now < this.monsterTokenExpiresAt - TOKEN_EXPIRY_BUFFER_MS) {
			return;
		}

		this.log.info('Authenticating with Monster Smart Lighting cloud service...');
		const response = await this.requestJson<MonsterLoginResponse>(
			`${MONSTER_BASE_URL}/v4/auth/login`,
			{
				method: 'POST',
				headers: {
					'accept': '*/*',
					'accept-language': 'en-US;q=1.0',
					'content-type': 'application/json',
					'user-agent': MONSTER_USER_AGENT,
					'x-copilot-sdk-version': MONSTER_SDK_VERSION,
				},
				body: JSON.stringify({
					deviceDetails: {
						osType: 'IOS',
						deviceId: MONSTER_DEVICE_ID,
						applicationVersion: '157',
						timezone: {
							currentTimeInClientInMilliseconds: Date.now(),
							offsetFromUTCInMilliseconds: -28_800_000,
							timeZoneId: 'America/Los_Angeles',
						},
						deviceType: 'PHONE',
						deviceModel: 'iPhone18,1',
						osVersion: '26.5',
					},
					authenticationDetails: {
						password: this.config.password,
						email: this.config.email,
						applicationId: MONSTER_APPLICATION_ID,
					},
				}),
			},
		);
		if (!response.accessToken || !response.refreshToken || !response.expiresIn) {
			throw new Error('Monster authentication response did not include expected token fields.');
		}
		this.monsterAccessToken = response.accessToken;
		this.monsterRefreshToken = response.refreshToken;
		this.monsterTokenExpiresAt = Date.now() + response.expiresIn * 1000;

		this.log.info('Monster authentication succeeded.');
	}

	private async signInToAyla(): Promise<void> {
		if (!this.spherePartnerTicket) {
			throw new Error('Cannot sign in to Ayla without a Sphere partner ticket.');
		}

		this.log.info('Exchanging Sphere partner ticket for Ayla access token.');

		const response = await this.requestJson<AylaTokenResponse>(
			`${AYLA_USER_BASE_URL}/api/v1/token_sign_in`,
			{
				method: 'POST',
				headers: {
					'accept': '*/*',
					'content-type': 'application/json',
					'user-agent': 'Runner/2.0.157(157) SDK: 9.0.8 (iPhone; iOS 26.5; Scale/3.00)',
				},
				body: JSON.stringify({
					token: this.spherePartnerTicket,
					app_id: AYLA_APP_ID,
					app_secret: AYLA_APP_SECRET,
				}),
			},
		);

		this.aylaAccessToken = response.access_token;
		this.aylaRefreshToken = response.refresh_token;
		this.aylaTokenExpiresAt = Date.now() + response.expires_in * 1000;

		this.log.info('Ayla authentication succeeded.');
	}

	private getAylaHeaders(): Record<string, string> {
		if (!this.aylaAccessToken) {
			throw new Error('Ayla access token is not available.');
		}

		return {
			'accept': '*/*',
			'authorization': `auth_token ${this.aylaAccessToken}`,
			'x-ayla-source': 'Mobile',
		};
	}
	
	private async requestAylaJson<T>(url: string, init: RequestInit): Promise<T> {
		await this.ensureAylaAuth();
	
		try {
			return await this.requestJson<T>(url, {
				...init,
				headers: {
					...this.getAylaHeaders(),
					...(init.headers ?? {}),
				},
			});
		} catch (error) {
			if (!this.isAuthError(error)) {
				throw error;
			}
	
			this.log.warn('Ayla auth token was rejected; re-authenticating and retrying request.');
	
			await this.recoverAylaAuth();
	
			return await this.requestJson<T>(url, {
				...init,
				headers: {
					...this.getAylaHeaders(),
					...(init.headers ?? {}),
				},
			});
		}
	}
	
	private async recoverAylaAuth(): Promise<void> {
		if (!this.authRecoveryPromise) {
			this.authRecoveryPromise = this.reauthenticateAyla()
				.finally(() => {
					this.authRecoveryPromise = null;
				});
		}
	
		await this.authRecoveryPromise;
	}
	
	private async reauthenticateAyla(): Promise<void> {
		this.clearAylaAuth();
	
		await this.ensureAylaAuth();
	
		this.log.info('Monster Smart Lighting cloud authentication recovered successfully.');
	}
	
	private clearAylaAuth(): void {
		this.spherePartnerTicket = null;
		this.aylaAccessToken = null;
		this.aylaRefreshToken = null;
		this.aylaTokenExpiresAt = 0;
	}
	
	private isAuthError(error: unknown): boolean {
		if (!(error instanceof Error)) {
			return false;
		}
	
		return error.message.includes('Request failed: 401')
			|| error.message.includes('Request failed: 403');
	}
	
	private async requestJson<T>(url: string, init: RequestInit): Promise<T> {
		const method = init.method ?? 'GET';
	
		this.log.debug(`HTTP request: ${method} ${url}`);
	
		if (init.headers) {
			this.log.debug(`HTTP request headers: ${this.redactForLog(JSON.stringify(init.headers))}`);
		}
	
		if (init.body && typeof init.body === 'string') {
			this.log.debug(`HTTP request body: ${this.redactForLog(init.body)}`);
		}
	
		const response = await fetch(url, init);
		const responseText = await response.text();
	
		this.log.debug(`HTTP response: ${response.status} ${response.statusText} ${url}`);
	
		if (responseText) {
			this.log.debug(`HTTP response body: ${this.redactForLog(responseText)}`);
		}
	
		if (!response.ok) {
			throw new Error(`Request failed: ${response.status} ${response.statusText} - ${responseText}`);
		}
	
		if (!responseText) {
			return undefined as T;
		}
	
		return JSON.parse(responseText) as T;
	}
	
	private redactForLog(value: string): string {
		return value
			.replace(/"password":"[^"]*"/g, '"password":"[REDACTED]"')
			.replace(/"accessToken":"[^"]*"/g, '"accessToken":"[REDACTED]"')
			.replace(/"refreshToken":"[^"]*"/g, '"refreshToken":"[REDACTED]"')
			.replace(/"access_token":"[^"]*"/g, '"access_token":"[REDACTED]"')
			.replace(/"refresh_token":"[^"]*"/g, '"refresh_token":"[REDACTED]"')
			.replace(/"partnerTicket":"[^"]*"/g, '"partnerTicket":"[REDACTED]"')
			.replace(/Bearer [A-Za-z0-9._-]+/g, 'Bearer [REDACTED]')
			.replace(/auth_token [A-Za-z0-9._-]+/g, 'auth_token [REDACTED]');
	}
}
