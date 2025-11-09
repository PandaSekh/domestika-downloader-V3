import * as cheerio from 'cheerio';
import * as cliProgress from 'cli-progress';
import inquirer from 'inquirer';
import puppeteer, { type HTTPRequest } from 'puppeteer';
import type { Credentials } from '../auth';
import domestikaAuth from '../auth';
import { isVideoCompleted } from '../csv/progress';
import { downloadVideo } from '../downloader/downloader';
import type { Unit, VideoSelection } from '../types';
import { debugLog, logError, setActiveMultiBar } from '../utils/debug';
import { getInitialProps } from './video-data';

export async function scrapeSite(
	courseUrl: string,
	subtitle_langs: string[] | null,
	auth: Credentials,
	downloadOption: string,
	courseTitle: string | null,
	completedVideos: Set<string> = new Set<string>()
): Promise<void> {
	// Configure Puppeteer
	const puppeteerOptions: Parameters<typeof puppeteer.launch>[0] = {
		headless: true,
		args: ['--no-sandbox', '--disable-setuid-sandbox'],
	};

	const browser = await puppeteer.launch(puppeteerOptions);
	const page = await browser.newPage();
	page.setDefaultNavigationTimeout(0);
	await page.setCookie(...auth.cookies);

	await page.setRequestInterception(true);
	const requestHandler = (req: HTTPRequest) => {
		if (
			req.resourceType() === 'stylesheet' ||
			req.resourceType() === 'font' ||
			req.resourceType() === 'image'
		) {
			req.abort();
		} else {
			req.continue();
		}
	};
	page.on('request', requestHandler);

	await page.goto(courseUrl);
	const html = await page.content();
	const $ = cheerio.load(html);

	console.log('Analyzing site');

	const allVideos: Unit[] = [];
	const units = $('h4.h2.unit-item__title a');

	// Check if we're on the correct page
	if (units.length === 0) {
		// Remove request interception listener before closing
		page.off('request', requestHandler);
		await page.setRequestInterception(false);
		await page.close();
		await browser.close();

		console.log('\n❌ No videos found. This may be due to invalid cookies.');

		const answer = await inquirer.prompt<{ updateCookies: boolean }>([
			{
				type: 'confirm',
				name: 'updateCookies',
				message: 'Do you want to update the cookies?',
				default: true,
			},
		]);

		if (answer.updateCookies) {
			// Force credential update
			await domestikaAuth.promptForCredentials(true);
			// Try again with new credentials
			return scrapeSite(
				courseUrl,
				subtitle_langs,
				await domestikaAuth.getCookies(),
				downloadOption,
				courseTitle,
				completedVideos
			);
		}
		throw new Error('Cannot download videos without valid cookies.');
	}

	console.log(`Course: ${courseTitle}`);
	console.log(`${units.length} Units detected`);

	for (let i = 0; i < units.length; i++) {
		const unitHref = $(units[i]).attr('href');
		if (!unitHref) continue;

		const videoData = await getInitialProps(unitHref, page);
		allVideos.push({
			title: $(units[i])
				.text()
				.replace(/\./g, '')
				.trim()
				.replace(/[/\\?%*:|"<>]/g, '-'),
			videoData: videoData,
			unitNumber: i + 1,
		});
	}

	// If user chose to download specific videos
	if (downloadOption === 'specific') {
		const videoChoices = allVideos.flatMap((unit) => {
			// Create separator/header for the unit
			const unitHeader = {
				name: `Unit ${unit.unitNumber}: ${unit.title}`,
				value: `unit_${unit.unitNumber}`,
				checked: false,
			};

			// Create options for each video with indentation
			const unitVideos = unit.videoData.map((vData, index) => ({
				name: `    ${index + 1}. ${vData.title}`,
				value: {
					unit: unit,
					videoData: vData,
					index: index + 1,
				},
				short: vData.title,
			}));

			return [unitHeader, ...unitVideos];
		});

		const selectedVideos = await inquirer.prompt<{ videosToDownload: (string | VideoSelection)[] }>(
			[
				{
					type: 'checkbox',
					name: 'videosToDownload',
					message: 'Select complete units or specific videos:',
					choices: videoChoices,
					pageSize: 20,
					loop: false,
				},
			]
		);

		// Process selections
		for (const selection of selectedVideos.videosToDownload) {
			if (typeof selection === 'string' && selection.startsWith('unit_')) {
				// If a complete unit was selected
				const unitNumber = Number.parseInt(selection.split('_')[1], 10);
				const unit = allVideos.find((u) => u.unitNumber === unitNumber);

				if (unit) {
					for (let i = 0; i < unit.videoData.length; i++) {
						const videoIndex = i + 1;
						const vData = unit.videoData[i];
						// Check if video is already completed (including file system check)
						if (
							await isVideoCompleted(
								courseUrl,
								unit.unitNumber,
								videoIndex,
								completedVideos,
								courseTitle,
								unit.title,
								vData.title,
								vData.section
							)
						) {
							console.log(`⏭️  Skipping already downloaded: ${vData.title}`);
							continue;
						}
						await downloadVideo(
							vData,
							courseTitle,
							unit.title,
							videoIndex,
							subtitle_langs,
							unit.unitNumber,
							undefined,
							courseUrl,
							completedVideos
						);
					}
				}
			} else if (typeof selection === 'object' && 'videoData' in selection) {
				// If a specific video was selected
				// Check if video is already completed (including file system check)
				if (
					await isVideoCompleted(
						courseUrl,
						selection.unit.unitNumber,
						selection.index,
						completedVideos,
						courseTitle,
						selection.unit.title,
						selection.videoData.title,
						selection.videoData.section
					)
				) {
					console.log(`⏭️  Skipping already downloaded: ${selection.videoData.title}`);
				} else {
					await downloadVideo(
						selection.videoData,
						courseTitle,
						selection.unit.title,
						selection.index,
						subtitle_langs,
						selection.unit.unitNumber,
						undefined,
						courseUrl,
						completedVideos
					);
				}
			}
		}

		// Remove request interception listener before closing
		page.off('request', requestHandler);
		await page.setRequestInterception(false);
		await page.close();
		await browser.close();
		return;
	}

	// If we reach here it's because downloadOption === 'all'
	console.log('Downloading entire course...');
	let downloadedCount = 0;

	// Count how many videos are already completed
	let skippedCount = 0;
	for (const unit of allVideos) {
		for (let i = 0; i < unit.videoData.length; i++) {
			const vData = unit.videoData[i];
			if (
				await isVideoCompleted(
					courseUrl,
					unit.unitNumber,
					i + 1,
					completedVideos,
					courseTitle,
					unit.title,
					vData.title,
					vData.section
				)
			) {
				skippedCount++;
			}
		}
	}

	if (skippedCount > 0) {
		console.log(`⏭️  Skipping ${skippedCount} already downloaded video(s)`);
	}

	console.log('📋 Building download queue...');

	// Create a MultiBar for parallel downloads to avoid progress bar conflicts
	const multiBar = new cliProgress.MultiBar({
		format: '  {title} |{bar}| {percentage}% | ETA: {eta}s',
		barCompleteChar: '\u2588',
		barIncompleteChar: '\u2591',
		hideCursor: true,
		clearOnComplete: true,
		stopOnComplete: true,
		linewrap: false,
		barsize: 40,
		forceRedraw: true,
		noTTYOutput: false,
		notTTYSchedule: 2000,
	});

	// Set as active multiBar for safe logging
	setActiveMultiBar(multiBar);

	// Build queue of download tasks (don't start them yet)
	interface DownloadTask {
		vData: (typeof allVideos)[0]['videoData'][0];
		unit: (typeof allVideos)[0];
		videoIndex: number;
	}

	const downloadQueue: DownloadTask[] = [];

	for (let i = 0; i < allVideos.length; i++) {
		const unit = allVideos[i];
		for (let a = 0; a < unit.videoData.length; a++) {
			const vData = unit.videoData[a];
			if (!vData || !vData.playbackURL) {
				logError(`Error: Invalid video data for ${unit.title} #${a}`, multiBar);
				continue;
			}

			const videoIndex = a + 1;
			// Check if video is already completed (including file system check)
			if (
				await isVideoCompleted(
					courseUrl,
					unit.unitNumber,
					videoIndex,
					completedVideos,
					courseTitle,
					unit.title,
					vData.title,
					vData.section
				)
			) {
				// Don't log skipped videos here - will be noisy with progress bars
				// The summary at the end will show how many were skipped
				continue;
			}

			downloadQueue.push({ vData, unit, videoIndex });
		}
	}

	// Process downloads with configurable concurrency (default: 2)
	const maxConcurrentEnv = process.env.MAX_CONCURRENT_DOWNLOADS
		? Number.parseInt(process.env.MAX_CONCURRENT_DOWNLOADS, 10)
		: 2;
	const MAX_CONCURRENT_DOWNLOADS =
		Number.isNaN(maxConcurrentEnv) || maxConcurrentEnv < 1 ? 2 : maxConcurrentEnv;

	// Log memory usage
	const logMemoryUsage = (label: string): void => {
		const usage = process.memoryUsage();
		const formatMB = (bytes: number): string => (bytes / 1024 / 1024).toFixed(2);
		debugLog(
			`[MEMORY] ${label}: RSS=${formatMB(usage.rss)}MB, HeapUsed=${formatMB(usage.heapUsed)}MB, HeapTotal=${formatMB(usage.heapTotal)}MB, External=${formatMB(usage.external)}MB`
		);
	};

	const queueSize = downloadQueue.length;
	if (queueSize > 0) {
		console.log(`🚀 Starting downloads: ${queueSize} video(s) to download (max ${MAX_CONCURRENT_DOWNLOADS} concurrent)`);
	} else {
		console.log('✅ All videos are already downloaded. Nothing to do.');
		multiBar.stop();
		setActiveMultiBar(null);
		await browser.close();
		return;
	}

	debugLog(
		`[DOWNLOAD] Starting download queue with ${queueSize} videos, max concurrency: ${MAX_CONCURRENT_DOWNLOADS}`
	);
	logMemoryUsage('Before starting downloads');

	// Process queue with concurrency limit using a more memory-efficient approach
	let processedCount = 0;

	// Use a Set to track active promises for better memory management
	const activePromises = new Set<Promise<void>>();

	for (const task of downloadQueue) {
		// Wait until we have a free slot
		while (activePromises.size >= MAX_CONCURRENT_DOWNLOADS) {
			// Block until ANY download finishes using Promise.race()
			// When it resolves, the completed download will have already removed itself
			// from activePromises via its finally() handler, freeing up a slot
			await Promise.race(Array.from(activePromises));
		}

		// Create and start the download promise
		const downloadPromise = (async (): Promise<void> => {
			try {
				await downloadVideo(
					task.vData,
					courseTitle,
					task.unit.title,
					task.videoIndex,
					subtitle_langs,
					task.unit.unitNumber,
					multiBar,
					courseUrl,
					completedVideos
				);
				downloadedCount++;
				processedCount++;

				// Log memory every 10 videos
				if (processedCount % 10 === 0) {
					logMemoryUsage(`After ${processedCount} videos processed`);
					debugLog(
						`[DOWNLOAD] Progress: ${processedCount}/${downloadQueue.length} videos processed, ${downloadedCount} downloaded, ${completedVideos.size} in completed set`
					);
				}
			} catch (error) {
				const err = error as Error;
				logError(`❌ Error in video ${task.vData.title}: ${err.message}`, multiBar);
				processedCount++;
			}
		})();

		// Add to active set and ensure cleanup when done
		activePromises.add(downloadPromise);
		downloadPromise.finally(() => {
			// Ensure we remove from active set when done
			activePromises.delete(downloadPromise);
		});
	}

	// Wait for all remaining downloads to complete
	await Promise.all(Array.from(activePromises));

	// Stop the MultiBar after all downloads complete
	multiBar.stop();
	// Clear active multiBar reference
	setActiveMultiBar(null);
	logMemoryUsage('After all downloads completed');

	// Print summary
	console.log(
		`\n✅ Download summary: ${downloadedCount} new video(s) downloaded, ${skippedCount} already downloaded`
	);

	if (downloadedCount === 0 && skippedCount === 0) {
		console.log('\n❌ Could not download any videos. This may be due to invalid cookies.');

		const answer = await inquirer.prompt<{ updateCookies: boolean }>([
			{
				type: 'confirm',
				name: 'updateCookies',
				message: 'Do you want to update the cookies?',
				default: true,
			},
		]);

		if (answer.updateCookies) {
			// Force credential update
			await domestikaAuth.promptForCredentials(true);
			// Try again with new credentials
			return scrapeSite(
				courseUrl,
				subtitle_langs,
				await domestikaAuth.getCookies(),
				downloadOption,
				courseTitle,
				completedVideos
			);
		}
	}

	// Remove request interception listener before closing
	page.off('request', requestHandler);
	await page.setRequestInterception(false);
	await page.close();
	await browser.close();
}
