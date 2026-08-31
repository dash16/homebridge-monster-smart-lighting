#!/usr/bin/env node

/* global console, fetch */

import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const LOGIN_URL = 'https://api.monstergen2.bycopilot.com/v4/auth/login';
const APPLICATION_ID = 'MONSTERGEN2';
const MIN_COOLDOWN_SECONDS = 10;
const HOMEBRIDGE_DEVICE_ID = '00000000-0000-0000-0000-000000000000';

const IOS_HEADERS = {
	'Accept': '*/*',
	'Accept-Language': 'en-US;q=1.0',
	'Content-Type': 'application/json',
	'User-Agent': 'Runner/2.0.157 (com.xtreme.monstersmartlighting; build:157; iOS 26.5.0) Alamofire/5.11.0',
	'x-copilot-sdk-version': '6.0.8',
};

const HOMEBRIDGE_HEADERS = {
	...IOS_HEADERS,
	'User-Agent': 'homebridge-monster-smart-lighting (Homebridge; Node.js)',
	'x-copilot-sdk-version': 'homebridge',
};

const IOS_DEVICE = {
	osType: 'IOS',
	deviceId: '62B62449-4052-4075-90C9-9427F31F1F51',
	applicationVersion: '157',
	deviceType: 'PHONE',
	deviceModel: 'iPhone18,1',
	osVersion: '26.5',
};

const HOMEBRIDGE_DEVICE = {
	osType: 'ANDROID',
	deviceId: HOMEBRIDGE_DEVICE_ID,
	applicationVersion: 'homebridge',
	deviceType: 'PC',
	deviceModel: 'Homebridge',
	osVersion: process.version,
};

const ANDROID_MOBILE_DEVICE = {
	osType: 'ANDROID',
	deviceId: HOMEBRIDGE_DEVICE_ID,
	applicationVersion: '157',
	deviceType: 'PHONE',
	deviceModel: 'Pixel 9',
	osVersion: '16',
};

const withHeader = (headers, name, value) => ({
	...headers,
	[name]: value,
});

const withDeviceField = (name, value) => ({
	...IOS_DEVICE,
	[name]: value,
});

const tests = [
	{
		name: 'ios_control',
		description: 'Known-good iOS headers and device identity.',
		headers: IOS_HEADERS,
		device: IOS_DEVICE,
	},
	{
		name: 'homebridge_headers_ios_body',
		description: 'Changes both client headers while retaining the iOS body.',
		headers: HOMEBRIDGE_HEADERS,
		device: IOS_DEVICE,
	},
	{
		name: 'homebridge_user_agent_ios_body',
		description: 'Changes only the user-agent.',
		headers: withHeader(IOS_HEADERS, 'User-Agent', HOMEBRIDGE_HEADERS['User-Agent']),
		device: IOS_DEVICE,
	},
	{
		name: 'homebridge_sdk_ios_body',
		description: 'Changes only x-copilot-sdk-version.',
		headers: withHeader(IOS_HEADERS, 'x-copilot-sdk-version', 'homebridge'),
		device: IOS_DEVICE,
	},
	{
		name: 'ios_headers_homebridge_body',
		description: 'Retains iOS headers while changing the entire device identity.',
		headers: IOS_HEADERS,
		device: HOMEBRIDGE_DEVICE,
	},
	{
		name: 'homebridge_device_id',
		description: 'Changes only deviceId.',
		headers: IOS_HEADERS,
		device: withDeviceField('deviceId', HOMEBRIDGE_DEVICE.deviceId),
	},
	{
		name: 'homebridge_application_version',
		description: 'Changes only applicationVersion.',
		headers: IOS_HEADERS,
		device: withDeviceField('applicationVersion', HOMEBRIDGE_DEVICE.applicationVersion),
	},
	{
		name: 'homebridge_device_type',
		description: 'Changes only deviceType.',
		headers: IOS_HEADERS,
		device: withDeviceField('deviceType', HOMEBRIDGE_DEVICE.deviceType),
	},
	{
		name: 'homebridge_device_model',
		description: 'Changes only deviceModel.',
		headers: IOS_HEADERS,
		device: withDeviceField('deviceModel', HOMEBRIDGE_DEVICE.deviceModel),
	},
	{
		name: 'homebridge_os_version',
		description: 'Changes only osVersion.',
		headers: IOS_HEADERS,
		device: withDeviceField('osVersion', HOMEBRIDGE_DEVICE.osVersion),
	},
	{
		name: 'android_os_type',
		description: 'Changes only osType; this intentionally creates a mixed identity.',
		headers: IOS_HEADERS,
		device: withDeviceField('osType', 'ANDROID'),
	},
	{
		name: 'android_mobile_ios_headers',
		description: 'Uses a coherent Android phone body with known-good iOS client headers.',
		headers: IOS_HEADERS,
		device: ANDROID_MOBILE_DEVICE,
	},
	{
		name: 'android_mobile_homebridge_user_agent',
		description: 'Uses a coherent Android phone body, generic user-agent, and SDK 6.0.8.',
		headers: withHeader(IOS_HEADERS, 'User-Agent', HOMEBRIDGE_HEADERS['User-Agent']),
		device: ANDROID_MOBILE_DEVICE,
	},
];

function getCooldownMilliseconds() {
	const configured = Number(process.env.AUTH_TEST_COOLDOWN_SECONDS ?? MIN_COOLDOWN_SECONDS);

	if (!Number.isFinite(configured)) {
		return MIN_COOLDOWN_SECONDS * 1000;
	}

	return Math.max(MIN_COOLDOWN_SECONDS, configured) * 1000;
}

function summarizeResponse(status, responseText) {
	let response;

	try {
		response = JSON.parse(responseText);
	} catch {
		return {
			status,
			reason: responseText ? 'non-JSON response' : 'empty response',
		};
	}

	return {
		status,
		reason: response.reason ?? response.errorMessage ?? response.error_message ?? null,
		errorCode: response.errorCode ?? null,
		expiresIn: response.expiresIn ?? null,
	};
}

function printMatrix() {
	console.log('Authentication profile matrix:');

	for (const [index, test] of tests.entries()) {
		console.log(`${String(index + 1).padStart(2, ' ')}. ${test.name}: ${test.description}`);
	}
}

async function run() {
	printMatrix();

	if (!process.argv.includes('--run')) {
		console.log('\nDry run only. Pass --run to execute the sequential login tests.');
		return;
	}

	const email = process.env.MONSTER_EMAIL;
	const password = process.env.MONSTER_PASSWORD;

	if (!email || !password) {
		throw new Error('Set MONSTER_EMAIL and MONSTER_PASSWORD before using --run.');
	}

	const cooldownMilliseconds = getCooldownMilliseconds();
	console.log(`\nRunning ${tests.length} tests with a ${cooldownMilliseconds / 1000}-second minimum cooldown.`);
	console.log('Only status and sanitized error metadata will be printed.\n');

	for (const [index, test] of tests.entries()) {
		const body = {
			deviceDetails: {
				...test.device,
				timezone: {
					currentTimeInClientInMilliseconds: Date.now(),
					offsetFromUTCInMilliseconds: new Date().getTimezoneOffset() * -60_000,
					timeZoneId: Intl.DateTimeFormat().resolvedOptions().timeZone,
				},
			},
			authenticationDetails: {
				email,
				password,
				applicationId: APPLICATION_ID,
			},
		};

		let result;

		try {
			const response = await fetch(LOGIN_URL, {
				method: 'POST',
				headers: test.headers,
				body: JSON.stringify(body),
			});
			result = summarizeResponse(response.status, await response.text());
		} catch (error) {
			result = {
				status: 'network-error',
				reason: error instanceof Error ? error.message : String(error),
			};
		}

		console.log(JSON.stringify({ test: test.name, ...result }));

		if (result.status === 401 || result.status === 403 || result.status === 429) {
			console.error(`Stopping after HTTP ${result.status} to protect the account and service.`);
			process.exitCode = 1;
			return;
		}

		if (index < tests.length - 1) {
			await delay(cooldownMilliseconds);
		}
	}
}

await run();
