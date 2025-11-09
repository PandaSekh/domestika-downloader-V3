import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as csvParseSync } from 'csv-parse/sync';

export interface DownloadStats {
	total: number;
	successful: number;
	failed: number;
	skipped: number;
}

export interface CourseStats {
	url: string;
	courseTitle: string | null;
	status: string;
	videos: VideoStats[];
}

export interface VideoStats {
	unitNumber: number;
	unitTitle: string;
	videoIndex: number;
	videoTitle: string;
	status: string;
	retryCount: number;
	error?: string;
	timestamp?: string;
}

export interface ReportData {
	timestamp: string;
	duration: number; // seconds
	stats: DownloadStats;
	courses: CourseStats[];
}

/**
 * Load video stats from progress.csv
 */
function loadVideoStats(): VideoStats[] {
	const progressFile = 'progress.csv';
	if (!fs.existsSync(progressFile)) {
		return [];
	}

	try {
		const content = fs.readFileSync(progressFile, 'utf-8');
		const records = csvParseSync(content, {
			columns: true,
			skip_empty_lines: true,
			trim: true,
		}) as Record<string, string>[];

		return records
			.filter((row) => {
				// Only include video-level entries (have unitNumber and videoIndex)
				return row.unitNumber && row.videoIndex;
			})
			.map((row) => ({
				unitNumber: Number.parseInt(row.unitNumber, 10),
				unitTitle: row.unitTitle || '',
				videoIndex: Number.parseInt(row.videoIndex, 10),
				videoTitle: row.videoTitle || '',
				status: row.status || 'unknown',
				retryCount: Number.parseInt(row.retryCount || '0', 10),
				timestamp: row.timestamp || undefined,
			}));
	} catch (error) {
		const err = error as Error;
		console.warn(`Warning: Could not read progress.csv for report: ${err.message}`);
		return [];
	}
}

/**
 * Generate report data from progress.csv
 */
export function generateReportData(startTime: number): ReportData {
	const endTime = Date.now();
	const duration = Math.round((endTime - startTime) / 1000);

	const videoStats = loadVideoStats();

	// Group by course
	const coursesMap = new Map<string, CourseStats>();

	// Process video stats
	for (const video of videoStats) {
		// We need to get course info from progress.csv
		// For now, we'll group by a key - we'll need to enhance this
		// Let's read the full CSV to get course info
	}

	// Read full CSV to get course and video info
	const progressFile = 'progress.csv';
	let allRecords: Record<string, string>[] = [];
	if (fs.existsSync(progressFile)) {
		try {
			const content = fs.readFileSync(progressFile, 'utf-8');
			allRecords = csvParseSync(content, {
				columns: true,
				skip_empty_lines: true,
				trim: true,
			}) as Record<string, string>[];
		} catch {
			// Ignore errors
		}
	}

	// Group records by course URL
	for (const record of allRecords) {
		const url = record.url || record.URL || record.course_url || record.courseUrl;
		if (!url) continue;

		if (!coursesMap.has(url)) {
			coursesMap.set(url, {
				url,
				courseTitle: record.courseTitle || null,
				status: record.status || 'unknown',
				videos: [],
			});
		}

		const course = coursesMap.get(url)!;

		// If it's a video-level entry
		if (record.unitNumber && record.videoIndex) {
			course.videos.push({
				unitNumber: Number.parseInt(record.unitNumber, 10),
				unitTitle: record.unitTitle || '',
				videoIndex: Number.parseInt(record.videoIndex, 10),
				videoTitle: record.videoTitle || '',
				status: record.status || 'unknown',
				retryCount: Number.parseInt(record.retryCount || '0', 10),
				timestamp: record.timestamp || undefined,
			});
		}
	}

	const courses = Array.from(coursesMap.values());

	// Calculate overall stats
	let total = 0;
	let successful = 0;
	let failed = 0;
	let skipped = 0;

	for (const course of courses) {
		for (const video of course.videos) {
			total++;
			if (video.status === 'completed') {
				successful++;
			} else if (video.status === 'failed') {
				failed++;
			} else {
				skipped++;
			}
		}
	}

	return {
		timestamp: new Date().toISOString(),
		duration,
		stats: {
			total,
			successful,
			failed,
			skipped,
		},
		courses,
	};
}

/**
 * Generate HTML report
 */
export function generateHTMLReport(data: ReportData): string {
	const formatDuration = (seconds: number): string => {
		const hours = Math.floor(seconds / 3600);
		const mins = Math.floor((seconds % 3600) / 60);
		const secs = seconds % 60;
		if (hours > 0) {
			return `${hours}h ${mins}m ${secs}s`;
		}
		if (mins > 0) {
			return `${mins}m ${secs}s`;
		}
		return `${secs}s`;
	};

	const formatDate = (isoString: string): string => {
		return new Date(isoString).toLocaleString();
	};

	const html = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Download Report - ${formatDate(data.timestamp)}</title>
	<style>
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
			margin: 0;
			padding: 20px;
			background-color: #f5f5f5;
		}
		.container {
			max-width: 1200px;
			margin: 0 auto;
			background: white;
			padding: 30px;
			border-radius: 8px;
			box-shadow: 0 2px 4px rgba(0,0,0,0.1);
		}
		h1 {
			color: #333;
			margin-top: 0;
		}
		.stats {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
			gap: 20px;
			margin: 30px 0;
		}
		.stat-card {
			background: #f8f9fa;
			padding: 20px;
			border-radius: 6px;
			text-align: center;
		}
		.stat-value {
			font-size: 2em;
			font-weight: bold;
			color: #007bff;
		}
		.stat-label {
			color: #666;
			margin-top: 5px;
		}
		.course {
			margin: 30px 0;
			padding: 20px;
			background: #f8f9fa;
			border-radius: 6px;
		}
		.course-title {
			font-size: 1.3em;
			font-weight: bold;
			margin-bottom: 10px;
		}
		.video-list {
			margin-top: 15px;
		}
		.video-item {
			padding: 10px;
			margin: 5px 0;
			background: white;
			border-radius: 4px;
			border-left: 4px solid #ddd;
		}
		.video-item.completed {
			border-left-color: #28a745;
		}
		.video-item.failed {
			border-left-color: #dc3545;
		}
		.video-item.skipped {
			border-left-color: #ffc107;
		}
		.meta {
			color: #666;
			font-size: 0.9em;
			margin-top: 20px;
			padding-top: 20px;
			border-top: 1px solid #ddd;
		}
	</style>
</head>
<body>
	<div class="container">
		<h1>Download Report</h1>
		
		<div class="stats">
			<div class="stat-card">
				<div class="stat-value">${data.stats.total}</div>
				<div class="stat-label">Total Videos</div>
			</div>
			<div class="stat-card">
				<div class="stat-value" style="color: #28a745;">${data.stats.successful}</div>
				<div class="stat-label">Successful</div>
			</div>
			<div class="stat-card">
				<div class="stat-value" style="color: #dc3545;">${data.stats.failed}</div>
				<div class="stat-label">Failed</div>
			</div>
			<div class="stat-card">
				<div class="stat-value" style="color: #ffc107;">${data.stats.skipped}</div>
				<div class="stat-label">Skipped</div>
			</div>
		</div>

		${data.courses
			.map(
				(course) => `
		<div class="course">
			<div class="course-title">${course.courseTitle || course.url}</div>
			<div style="color: #666; font-size: 0.9em; margin-bottom: 10px;">${course.url}</div>
			<div class="video-list">
				${course.videos
					.map(
						(video) => `
				<div class="video-item ${video.status}">
					<strong>Unit ${video.unitNumber}: ${video.unitTitle}</strong> - Video ${video.videoIndex}: ${video.videoTitle}
					<div style="margin-top: 5px; font-size: 0.9em;">
						Status: <strong>${video.status}</strong>
						${video.retryCount > 0 ? ` | Retries: ${video.retryCount}` : ''}
						${video.timestamp ? ` | ${formatDate(video.timestamp)}` : ''}
					</div>
				</div>
			`
					)
					.join('')}
			</div>
		</div>
	`
			)
			.join('')}

		<div class="meta">
			<p><strong>Generated:</strong> ${formatDate(data.timestamp)}</p>
			<p><strong>Duration:</strong> ${formatDuration(data.duration)}</p>
		</div>
	</div>
</body>
</html>`;

	return html;
}

/**
 * Generate and save reports
 */
export function saveReports(data: ReportData): void {
	const reportsDir = path.join(process.cwd(), '.reports');
	if (!fs.existsSync(reportsDir)) {
		fs.mkdirSync(reportsDir, { recursive: true });
	}

	const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
	const htmlPath = path.join(reportsDir, `report-${timestamp}.html`);
	const jsonPath = path.join(reportsDir, `report-${timestamp}.json`);

	// Save HTML report
	const html = generateHTMLReport(data);
	fs.writeFileSync(htmlPath, html, 'utf-8');

	// Save JSON report
	fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8');

	console.log(`\n📊 Reports generated:`);
	console.log(`   HTML: ${htmlPath}`);
	console.log(`   JSON: ${jsonPath}`);
}

