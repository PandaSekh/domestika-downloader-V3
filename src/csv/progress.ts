import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as csvParseSync } from 'csv-parse/sync';
import { stringify as csvStringifySync } from 'csv-stringify/sync';
import { logDebug } from '../utils/debug';
import { getDownloadPath } from '../utils/paths';
import { normalizeDomestikaUrl } from '../utils/url';

// Function to generate a unique video ID
export function getVideoId(courseUrl: string, unitNumber: number, videoIndex: number): string {
	const normalized = normalizeDomestikaUrl(courseUrl);
	return `${normalized.url}|${unitNumber}|${videoIndex}`;
}

// Function to load progress from progress.csv
export function loadProgress(): Set<string> {
	const progressFile = 'progress.csv';
	if (!fs.existsSync(progressFile)) {
		logDebug('[PROGRESS] progress.csv does not exist, starting with empty set');
		return new Set<string>();
	}

	try {
		const stats = fs.statSync(progressFile);
		logDebug(`[PROGRESS] Loading progress.csv (${(stats.size / 1024).toFixed(2)}KB)`);

		const content = fs.readFileSync(progressFile, 'utf-8');
		const records = csvParseSync(content, {
			columns: true,
			skip_empty_lines: true,
			trim: true,
		}) as Record<string, string>[];

		logDebug(`[PROGRESS] Parsed ${records.length} records from CSV`);

		// Create a set of completed video IDs (only count "completed" status)
		const completed = new Set<string>();
		for (const row of records) {
			const url = row.url || row.URL || row.course_url || row.courseUrl;
			const status = row.status || row.Status || '';
			const unitNumber = row.unitNumber || row.unit_number;
			const videoIndex = row.videoIndex || row.video_index;

			// Check if this is a video-level entry (has unitNumber and videoIndex)
			if (url && unitNumber && videoIndex && status.toLowerCase() === 'completed') {
				const normalized = normalizeDomestikaUrl(url);
				const videoId = getVideoId(
					normalized.url,
					Number.parseInt(unitNumber, 10),
					Number.parseInt(videoIndex, 10)
				);
				completed.add(videoId);
			} else if (url && status.toLowerCase() === 'completed' && !unitNumber && !videoIndex) {
				// Backward compatibility: if it's a course-level entry, mark all videos as completed
				// This handles old progress.csv files
				const normalized = normalizeDomestikaUrl(url);
				// We can't know which videos were completed, so we'll skip this course entirely
				// by adding a special marker
				completed.add(`${normalized.url}|*|*`);
			}
		}

		logDebug(`[PROGRESS] Loaded ${completed.size} completed video IDs into memory`);
		return completed;
	} catch (error) {
		const err = error as Error;
		console.warn(`Warning: Could not read progress.csv: ${err.message}`);
		return new Set<string>();
	}
}

// Function to check if a video file exists in the destination folder
export async function checkVideoFileExists(
	courseTitle: string | null,
	unitTitle: string,
	unitNumber: number,
	videoIndex: number,
	videoTitle: string,
	section: string
): Promise<string | null> {
	const baseDownloadPath = getDownloadPath();
	const finalDir = path.normalize(
		path.join(baseDownloadPath, courseTitle || 'Unknown Course', section, unitTitle)
	);

	if (!fs.existsSync(finalDir)) {
		return null;
	}

	const fileNameBase = `${courseTitle} - U${unitNumber} - ${videoIndex}_${videoTitle.trimEnd()}`;

	// Check for various possible file extensions
	const possibleExtensions = ['.mp4', '.m3u8', '.ts', '.mkv', '.avi'];

	// Check files in the directory
	try {
		const files = fs.readdirSync(finalDir);
		for (const file of files) {
			// Check if file starts with the expected name
			if (file.startsWith(fileNameBase)) {
				// Check if it's a video file (has video extension or is a common video format)
				const ext = path.extname(file).toLowerCase();
				if (possibleExtensions.includes(ext) || ext === '') {
					const fullPath = path.join(finalDir, file);
					// Verify it's actually a file and not a directory
					const stats = fs.statSync(fullPath);
					if (stats.isFile() && stats.size > 0) {
						return fullPath;
					}
				}
			}
		}
	} catch {
		// If we can't read the directory, return null
		return null;
	}

	return null;
}

// Function to check if a video is already completed
export async function isVideoCompleted(
	courseUrl: string,
	unitNumber: number,
	videoIndex: number,
	completedVideos: Set<string>,
	courseTitle?: string | null,
	unitTitle?: string,
	videoTitle?: string,
	section?: string
): Promise<boolean> {
	const videoId = getVideoId(courseUrl, unitNumber, videoIndex);
	// Check if this specific video is completed in progress.csv
	if (completedVideos.has(videoId)) {
		return true;
	}
	// Check if the entire course is marked as completed (backward compatibility)
	const normalized = normalizeDomestikaUrl(courseUrl);
	if (completedVideos.has(`${normalized.url}|*|*`)) {
		return true;
	}
	// Check if the video file exists in the destination folder
	if (
		courseTitle !== undefined &&
		unitTitle !== undefined &&
		videoTitle !== undefined &&
		section !== undefined
	) {
		const existingFile = await checkVideoFileExists(
			courseTitle,
			unitTitle,
			unitNumber,
			videoIndex,
			videoTitle,
			section
		);
		if (existingFile) {
			return true;
		}
	}
	return false;
}

// Cache to track written video IDs to avoid duplicate writes in this session
const writtenVideoIds = new Set<string>();

// Check if CSV file has header
function hasCsvHeader(filePath: string): boolean {
	if (!fs.existsSync(filePath)) {
		return false;
	}
	try {
		const content = fs.readFileSync(filePath, 'utf-8');
		const firstLine = content.split('\n')[0]?.trim();
		// Support both old format (without retryCount) and new format (with retryCount)
		return (
			firstLine === 'url,courseTitle,unitNumber,unitTitle,videoIndex,videoTitle,status,timestamp' ||
			firstLine ===
				'url,courseTitle,unitNumber,unitTitle,videoIndex,videoTitle,status,timestamp,retryCount'
		);
	} catch {
		return false;
	}
}

// Function to save video-level progress to progress.csv
export function saveVideoProgress(
	courseUrl: string,
	courseTitle: string | null,
	unitNumber: number,
	unitTitle: string,
	videoIndex: number,
	videoTitle: string,
	status = 'completed',
	retryCount = 0
): void {
	const progressFile = 'progress.csv';
	const normalized = normalizeDomestikaUrl(courseUrl);
	const videoId = getVideoId(normalized.url, unitNumber, videoIndex);

	// Skip if we've already written this video in this session
	if (writtenVideoIds.has(videoId)) {
		return;
	}

	const entry: Record<string, string> = {
		url: normalized.url,
		courseTitle: courseTitle || normalized.courseTitle || '',
		unitNumber: unitNumber.toString(),
		unitTitle: unitTitle,
		videoIndex: videoIndex.toString(),
		videoTitle: videoTitle,
		status: status,
		timestamp: new Date().toISOString(),
		retryCount: retryCount.toString(),
	};

	try {
		// Check if file exists and has header
		const fileExists = fs.existsSync(progressFile);
		const hasHeader = hasCsvHeader(progressFile);

		if (!fileExists || !hasHeader) {
			// Write header if file doesn't exist or doesn't have proper header
			const header =
				'url,courseTitle,unitNumber,unitTitle,videoIndex,videoTitle,status,timestamp,retryCount\n';
			if (!fileExists) {
				fs.writeFileSync(progressFile, header, 'utf-8');
			} else {
				// File exists but no header - prepend header (read existing, prepend header, write back)
				const existingContent = fs.readFileSync(progressFile, 'utf-8');
				fs.writeFileSync(progressFile, header + existingContent, 'utf-8');
			}
		}

		// Append the entry as a CSV row (simple append, no full file read)
		const csvRow = `${[
			`"${entry.url.replace(/"/g, '""')}"`,
			`"${entry.courseTitle.replace(/"/g, '""')}"`,
			`"${entry.unitNumber}"`,
			`"${entry.unitTitle.replace(/"/g, '""')}"`,
			`"${entry.videoIndex}"`,
			`"${entry.videoTitle.replace(/"/g, '""')}"`,
			`"${entry.status}"`,
			`"${entry.timestamp}"`,
			`"${entry.retryCount}"`,
		].join(',')}\n`;

		fs.appendFileSync(progressFile, csvRow, 'utf-8');
		writtenVideoIds.add(videoId);
	} catch (error) {
		const err = error as Error;
		console.error(`Error writing progress.csv: ${err.message}`);
	}
}

// Function to save progress to progress.csv (backward compatibility for course-level status)
export function saveProgress(
	courseUrl: string,
	courseTitle: string | null,
	status = 'completed'
): void {
	const progressFile = 'progress.csv';
	const normalized = normalizeDomestikaUrl(courseUrl);

	// Check if entry already exists
	let records: Record<string, string>[] = [];
	if (fs.existsSync(progressFile)) {
		try {
			const content = fs.readFileSync(progressFile, 'utf-8');
			records = csvParseSync(content, {
				columns: true,
				skip_empty_lines: true,
				trim: true,
			}) as Record<string, string>[];
		} catch (error) {
			const err = error as Error;
			console.warn(`Warning: Could not read existing progress.csv: ${err.message}`);
		}
	}

	// Check if this course is already in progress (course-level entry)
	const existingIndex = records.findIndex((row) => {
		const rowUrl = row.url || row.URL || row.course_url || row.courseUrl;
		const rowUnitNumber = row.unitNumber || row.unit_number;
		const rowVideoIndex = row.videoIndex || row.video_index;
		// Only match course-level entries (no unitNumber/videoIndex)
		if (rowUrl && !rowUnitNumber && !rowVideoIndex) {
			const rowNormalized = normalizeDomestikaUrl(rowUrl);
			return rowNormalized.url === normalized.url;
		}
		return false;
	});

	const entry: Record<string, string> = {
		url: normalized.url,
		courseTitle: courseTitle || normalized.courseTitle || '',
		unitNumber: '',
		unitTitle: '',
		videoIndex: '',
		videoTitle: '',
		status: status,
		timestamp: new Date().toISOString(),
	};

	if (existingIndex >= 0) {
		records[existingIndex] = entry;
	} else {
		records.push(entry);
	}

	// Write back to CSV
	try {
		// Ensure all records have the same columns
		const allRecords = records.map((record) => ({
			url: record.url || '',
			courseTitle: record.courseTitle || '',
			unitNumber: record.unitNumber || record.unit_number || '',
			unitTitle: record.unitTitle || record.unit_title || '',
			videoIndex: record.videoIndex || record.video_index || '',
			videoTitle: record.videoTitle || record.video_title || '',
			status: record.status || '',
			timestamp: record.timestamp || '',
		}));

		const csvContent = csvStringifySync(allRecords, {
			header: true,
			columns: [
				'url',
				'courseTitle',
				'unitNumber',
				'unitTitle',
				'videoIndex',
				'videoTitle',
				'status',
				'timestamp',
			],
		});
		fs.writeFileSync(progressFile, csvContent, 'utf-8');
	} catch (error) {
		const err = error as Error;
		console.error(`Error writing progress.csv: ${err.message}`);
	}
}
