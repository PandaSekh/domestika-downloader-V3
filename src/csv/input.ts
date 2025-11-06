import * as fs from 'node:fs';
import { parse as csvParseSync } from 'csv-parse/sync';
import type { CSVCourse } from '../types';

// Function to read courses from input.csv
export function readInputCSV(): CSVCourse[] | null {
	const inputFile = 'input.csv';
	if (!fs.existsSync(inputFile)) {
		return null;
	}

	try {
		const content = fs.readFileSync(inputFile, 'utf-8');
		const records = csvParseSync(content, {
			columns: true,
			skip_empty_lines: true,
			trim: true,
			delimiter: ';',
		}) as Record<string, string>[];

		// Expected format: url, subtitles (optional), downloadOption (optional)
		return records
			.map((row) => ({
				url: row.url || row.URL || row.course_url || row.courseUrl,
				subtitles: row.subtitles || row.subtitle || row.sub || null,
				downloadOption: row.downloadOption || row.download_option || row.option || 'all',
			}))
			.filter((row) => row.url) as CSVCourse[]; // Filter out rows without URLs
	} catch (error) {
		const err = error as Error;
		throw new Error(`Error reading input.csv: ${err.message}`);
	}
}
