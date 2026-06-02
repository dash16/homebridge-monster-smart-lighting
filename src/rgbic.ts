//src/rgbic.ts
export type RgbicSwatch =
	| { type: 'rgb'; red: number; green: number; blue: number }
	| { type: 'white'; value: number };

export function encodeRgbicPayload(swatches: RgbicSwatch[]): string {
	const bytes: number[] = [];

	for (const swatch of swatches) {
		if (swatch.type === 'rgb') {
			bytes.push(0xe4, swatch.red, swatch.green, swatch.blue);
		} else {
			bytes.push(swatch.value);
		}
	}

	return Buffer.from(bytes).toString('base64');
}