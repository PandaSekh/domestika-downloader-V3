import * as fs from 'node:fs';
import inquirer from 'inquirer';
// Parse CLI args before loading dotenv so CLI args can override .env values
import { parseCliArgs } from './utils/cli-args';

parseCliArgs();
// Now load dotenv (CLI args will override any .env values)
import 'dotenv/config';
// Parse CLI args again to ensure they override dotenv values
parseCliArgs();

import domestikaAuth from './auth';
import { readInputCSV } from './csv/input';
import { loadProgress, saveProgress } from './csv/progress';
import { scrapeSite } from './scraper/scraper';
import type { CourseToProcess, InquirerAnswers } from './types';
import { getFilteredCliArgs } from './utils/cli-args';
import { logDebug, logError, logSuccess } from './utils/debug';
import { getN3u8DLPath } from './utils/paths';
import { generateReportData, saveReports } from './utils/reports';
import { parseSubtitleLanguages } from './utils/subtitles';
import { normalizeDomestikaUrl } from './utils/url';

// Helper function to log memory usage
function logMemoryUsage(label: string): void {
	const usage = process.memoryUsage();
	const formatMB = (bytes: number): string => (bytes / 1024 / 1024).toFixed(2);
	logDebug(
		`[MEMORY] ${label}: RSS=${formatMB(usage.rss)}MB, HeapUsed=${formatMB(usage.heapUsed)}MB, HeapTotal=${formatMB(usage.heapTotal)}MB, External=${formatMB(usage.external)}MB`
	);
}

// Main function
export async function main(): Promise<void> {
	const startTime = Date.now();
	try {
		console.log('Starting Domestika Downloader...');

		// Get credentials
		const auth = await domestikaAuth.getCookies();

		// Check for input.csv file first
		const csvCourses = readInputCSV();
		let answers: InquirerAnswers | undefined;
		let coursesToProcess: CourseToProcess[] = [];

		if (csvCourses && csvCourses.length > 0) {
			console.log(`\nFound ${csvCourses.length} courses in input.csv`);

			// Convert CSV courses to the format expected by the processing loop
			// We don't filter courses here anymore - we'll check individual videos during download
			coursesToProcess = csvCourses.map((course) => {
				const normalized = normalizeDomestikaUrl(course.url);
				return {
					url: normalized.url,
					courseTitle: normalized.courseTitle,
					subtitles: parseSubtitleLanguages(course.subtitles),
					downloadOption: course.downloadOption || 'all',
				};
			});
		} else {
			// Check for command-line arguments (filter out flags)
			const filteredArgs = getFilteredCliArgs();
			if (filteredArgs.length > 0) {
				// Use command-line arguments if provided
				const courseUrls = filteredArgs[0];
				const subtitles = filteredArgs[1] || null; // Optional subtitle language
				const downloadOption = filteredArgs[2] || 'all'; // Optional download option (default: all)

				// Validate URL
				const urls = courseUrls.trim().split(' ');
				const validUrls = urls.every((url) => {
					return url.match(/domestika\.org\/.*?\/courses\/\d+[-\w]+/);
				});

				if (!validUrls) {
					throw new Error('Please provide valid Domestika course URLs');
				}

				// Convert command-line args to course format
				const normalizedUrls = urls.map((url) => normalizeDomestikaUrl(url));
				const parsedSubtitles = parseSubtitleLanguages(subtitles);
				coursesToProcess = normalizedUrls.map((urlInfo) => ({
					url: urlInfo.url,
					courseTitle: urlInfo.courseTitle,
					subtitles: parsedSubtitles,
					downloadOption: downloadOption,
				}));

				console.log('Using command-line arguments:');
				console.log(`  Course URLs: ${courseUrls}`);
				console.log(`  Subtitles: ${parsedSubtitles ? parsedSubtitles.join(', ') : 'None'}`);
				console.log(`  Download Option: ${downloadOption}`);
			} else {
				// Ask user for options interactively
				answers = await inquirer.prompt<InquirerAnswers>([
					{
						type: 'input' as const,
						name: 'courseUrls',
						message: 'Course URLs (separated by spaces):',
						validate: (input: string) => {
							const urls = input.trim().split(' ');
							const validUrls = urls.every((url) => {
								// Verify that it's a Domestika course URL
								return url.match(/domestika\.org\/.*?\/courses\/\d+[-\w]+/);
							});
							if (validUrls) {
								return true;
							}
							return 'Please enter valid Domestika course URLs';
						},
					},
					{
						type: 'checkbox' as const,
						name: 'subtitles',
						message: 'Select subtitle languages (space to select, enter to confirm):',
						choices: [
							{ name: 'Spanish', value: 'es' },
							{ name: 'English', value: 'en' },
							{ name: 'Portuguese', value: 'pt' },
							{ name: 'French', value: 'fr' },
							{ name: 'German', value: 'de' },
							{ name: 'Italian', value: 'it' },
						],
					},
					{
						type: 'list' as const,
						name: 'downloadOption',
						message: 'What do you want to download?',
						choices: [
							{ name: 'Entire course', value: 'all' },
							{ name: 'Specific videos', value: 'specific' },
						],
					},
				]);

				// Convert interactive answers to course format
				const urls = answers?.courseUrls.trim().split(' ');
				coursesToProcess = urls.map((url) => {
					const normalized = normalizeDomestikaUrl(url);
					// Convert array to null if empty, otherwise use the array
					const subtitleArray =
						answers?.subtitles && answers.subtitles.length > 0 ? answers.subtitles : null;
					return {
						url: normalized.url,
						courseTitle: normalized.courseTitle,
						subtitles: subtitleArray,
						downloadOption: answers?.downloadOption || 'all',
					};
				});
			}
		}

		// Check N_m3u8DL-RE
		const N_M3U8DL_RE = getN3u8DLPath();
		if (!fs.existsSync(N_M3U8DL_RE)) {
			throw new Error(
				`${N_M3U8DL_RE} not found! Download the Binary here: https://github.com/nilaoda/N_m3u8DL-RE/releases`
			);
		}

		// Load completed videos for video-level progress tracking
		logMemoryUsage('Before loadProgress');
		const completedVideos = loadProgress();
		logMemoryUsage(`After loadProgress (${completedVideos.size} videos in set)`);

		// Display courses to be processed
		if (coursesToProcess.length === 0) {
			console.log('No courses to process.');
			return;
		}

		console.log(`\n${coursesToProcess.length} course(s) will be processed:`);
		coursesToProcess.forEach((course, index) => {
			console.log(`${index + 1}. ${course.url} (${course.courseTitle || 'Unknown'})`);
		});

		// Process each course
		for (let i = 0; i < coursesToProcess.length; i++) {
			const course = coursesToProcess[i];
			console.log(
				`\nProcessing course ${i + 1} of ${coursesToProcess.length}: ${course.courseTitle || course.url}`
			);
			logMemoryUsage(`Before processing course ${i + 1}`);

			try {
				// Update progress to "processing" before starting (course-level status)
				saveProgress(course.url, course.courseTitle, 'processing');

				// Process the course (pass completed videos for video-level checking)
				await scrapeSite(
					course.url,
					course.subtitles,
					auth,
					course.downloadOption,
					course.courseTitle,
					completedVideos
				);

				logMemoryUsage(`After processing course ${i + 1}`);
				logSuccess(`Course processing completed: ${course.courseTitle || course.url}`);
			} catch (error) {
				// Mark as failed
				const err = error as Error;
				saveProgress(course.url, course.courseTitle, 'failed');
				logError(`Course failed: ${course.courseTitle || course.url} - ${err.message}`);
				logMemoryUsage(`After failed course ${i + 1}`);
				// Continue with next course instead of stopping
			}
		}

		logSuccess('\nAll courses have been processed');

		// Generate reports
		const reportData = generateReportData(startTime);
		saveReports(reportData);
	} catch (error) {
		const err = error as Error;
		console.error('Error:', err.message);
		// Still generate report even on error
		try {
			const reportData = generateReportData(startTime);
			saveReports(reportData);
		} catch (_reportError) {
			// Ignore report generation errors
		}
		process.exit(1);
	}
}

// Start the application
if (require.main === module) {
	main().catch((error: Error) => {
		console.error('Fatal error:', error);
		process.exit(1);
	});
}
