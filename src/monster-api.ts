// src/monster-api.ts

import type { Logger } from 'homebridge';

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

export interface MonsterProperty {
	name: string;
	baseType: string;
	readOnly: boolean;
	value: string | number | boolean | null;
	key: number;
	deviceKey: number;
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

	constructor(
		private readonly log: Logger,
		private readonly config: MonsterApiConfig,
	) {}

	public async getDevices(): Promise<MonsterDevice[]> {
		await this.ensureAylaAuth();

		const response = await this.requestJson<AylaDeviceResponse[]>(
			`${AYLA_DEVICE_BASE_URL}/apiv1/devices.json`,
			{
				method: 'GET',
				headers: this.getAylaHeaders(),
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
		await this.ensureAylaAuth();

		const response = await this.requestJson<AylaPropertyResponse[]>(
			`${AYLA_DEVICE_BASE_URL}/apiv1/dsns/${encodeURIComponent(dsn)}/properties.json`,
			{
				method: 'GET',
				headers: this.getAylaHeaders(),
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

	public async setProperty(
		dsn: string,
		propertyName: string,
		value: string | number | boolean,
	): Promise<void> {
		await this.ensureAylaAuth();

		await this.requestJson<unknown>(
			`${AYLA_DEVICE_BASE_URL}/apiv1/dsns/${encodeURIComponent(dsn)}/properties/${encodeURIComponent(propertyName)}/datapoints.json`,
			{
				method: 'POST',
				headers: {
					...this.getAylaHeaders(),
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

	private async acquireSphereTicket(): Promise<void> {
		if (!this.monsterAccessToken) {
			throw new Error('Cannot acquire Sphere partner ticket without a Monster access token.');
		}

		this.log.debug('Acquiring Sphere partner ticket...');

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

		this.log.debug(`Sphere partner ticket acquired. Ticket length: ${response.partnerTicket.length}`);
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

		this.log.debug(`Monster login config: email=${this.config.email}, passwordLength=${this.config.password.length}`);
		this.log.debug('Authenticating with Monster Smart Lighting cloud service...');
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

		this.log.debug('Monster authentication succeeded.');
		this.log.debug(`Monster token length: ${response.accessToken.length}`);
	}

	private async signInToAyla(): Promise<void> {
		if (!this.spherePartnerTicket) {
			throw new Error('Cannot sign in to Ayla without a Sphere partner ticket.');
		}

		this.log.debug('Exchanging Sphere partner ticket for Ayla access token.');

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

		this.log.debug('Ayla authentication succeeded.');
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
