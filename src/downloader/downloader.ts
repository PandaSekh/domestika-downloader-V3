import * as fs from 'node:fs';
import * as path from 'node:path';
import type * as cliProgress from 'cli-progress';
import { checkVideoFileExists, getVideoId, saveVideoProgress } from '../csv/progress';
import { embedSubtitles } from '../subtitles/embed';
import type { VideoData } from '../types';
import { debugLog, isDebug, logError } from '../utils/debug';
import { getDownloadPath, getYtDlpCommand } from '../utils/paths';
import { executeWithProgress } from './progress-bar';

/**
 * Wait for a file to be fully written by checking if its size stabilizes
 */
async function waitForFileComplete(
	filePath: string,
	maxWaitTime = 30000,
	checkInterval = 500
): Promise<void> {
	const startTime = Date.now();
	let lastSize = 0;
	let stableCount = 0;
	const requiredStableChecks = 3; // File size must be stable for 3 consecutive checks

	while (Date.now() - startTime < maxWaitTime) {
		if (!fs.existsSync(filePath)) {
			await new Promise((resolve) => setTimeout(resolve, checkInterval));
			continue;
		}

		const stats = fs.statSync(filePath);
		const currentSize = stats.size;

		if (currentSize === lastSize) {
			stableCount++;
			if (stableCount >= requiredStableChecks) {
				// File size is stable, but wait a bit more to ensure write is complete
				await new Promise((resolve) => setTimeout(resolve, 1000));
				return;
			}
		} else {
			stableCount = 0;
			lastSize = currentSize;
		}

		await new Promise((resolve) => setTimeout(resolve, checkInterval));
	}

	// If we've waited the max time, check if file exists and has reasonable size
	if (fs.existsSync(filePath)) {
		const stats = fs.statSync(filePath);
		if (stats.size > 0) {
			// File exists and has content, proceed (might still be writing but we'll try)
			return;
		}
	}

	throw new Error(`File ${filePath} did not complete within ${maxWaitTime}ms`);
}

export async function downloadVideo(
	vData: VideoData,
	courseTitle: string | null,
	unitTitle: string,
	index: number,
	subtitle_langs: string[] | null,
	unitNumber: number,
	multiBar?: cliProgress.MultiBar,
	courseUrl?: string,
	completedVideos?: Set<string>
): Promise<boolean> {
	if (!vData.playbackURL) {
		throw new Error(`Invalid video URL for ${vData.title}`);
	}

	const cleanPath = (p: string) => p.replace(/\/+/g, '/');
	const baseDownloadPath = getDownloadPath();
	const finalDir = cleanPath(
		path.join(baseDownloadPath, courseTitle || 'Unknown Course', vData.section, unitTitle)
	);

	try {
		// Check if video file already exists in destination folder
		const existingFile = await checkVideoFileExists(
			courseTitle,
			unitTitle,
			unitNumber,
			index,
			vData.title,
			vData.section
		);
		if (existingFile) {
			// Save to progress if courseUrl is provided
			if (courseUrl && completedVideos) {
				saveVideoProgress(
					courseUrl,
					courseTitle,
					unitNumber,
					unitTitle,
					index,
					vData.title,
					'completed'
				);
				// Add to completed videos set for this session
				const videoId = getVideoId(courseUrl, unitNumber, index);
				completedVideos.add(videoId);
			}

			return true;
		}

		if (!fs.existsSync(finalDir)) {
			fs.mkdirSync(finalDir, { recursive: true });
		}

		const fileName = `${index}_${vData.title.trimEnd()}`;
		const ytDlpCommand = getYtDlpCommand();

		// Build yt-dlp arguments - simplified approach that works reliably
		const ytDlpArgs: string[] = [
			'--output',
			fileName, // Simple filename pattern
			'--paths',
			finalDir, // Set the download directory
			'--format',
			'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best', // Prefer 1080p, fallback to best
		];

		// Add verbose flag if debug mode is enabled
		if (isDebug()) {
			ytDlpArgs.push('--verbose');
		}

		// Add subtitle options if languages are specified
		if (subtitle_langs && subtitle_langs.length > 0) {
			ytDlpArgs.push('--sub-langs', subtitle_langs.join(',')); // Specify subtitle languages
			ytDlpArgs.push('--embed-subs'); // Embed subtitles in video file
			debugLog(`[DOWNLOAD] Downloading video with subtitles: ${subtitle_langs.join(', ')}`);
		}

		// Add the video URL
		ytDlpArgs.push(vData.playbackURL);

		debugLog(`[DOWNLOAD] yt-dlp command: ${ytDlpCommand} ${ytDlpArgs.join(' ')}`);

		let downloadSuccess = false;
		try {
			await executeWithProgress(ytDlpCommand, ytDlpArgs, vData.title, multiBar);
			downloadSuccess = true;
		} catch (error) {
			const err = error as Error;
			logError(`Failed to download video: ${err.message}`, multiBar);
			throw new Error(`Error downloading video: ${err.message}`);
		}

		if (downloadSuccess) {
			// Find the downloaded video file (yt-dlp may output .mp4, .mkv, etc.)
			// yt-dlp will add the extension automatically based on the format
			const videoExtensions = ['.mp4', '.mkv', '.webm', '.m4v', '.mov', '.ts'];
			let actualVideoPath: string | null = null;

			// Try to find the video file with expected name (yt-dlp adds extension)
			for (const ext of videoExtensions) {
				const candidatePath = path.join(finalDir, `${fileName}${ext}`);
				if (fs.existsSync(candidatePath)) {
					actualVideoPath = candidatePath;
					break;
				}
			}

			// If not found, search for any video file starting with the filename
			if (!actualVideoPath) {
				const files = fs.readdirSync(finalDir);
				const videoFiles = files.filter(
					(f) =>
						f.startsWith(fileName) &&
						videoExtensions.some((ext) => f.endsWith(ext))
				);
				if (videoFiles.length > 0) {
					actualVideoPath = path.join(finalDir, videoFiles[0]);
				}
			}

			if (!actualVideoPath) {
				logError(`Video file not found after download: ${fileName}`, multiBar);
				throw new Error(`Video file not found after download: ${fileName}`);
			}

			// Wait for file to be fully written
			await waitForFileComplete(actualVideoPath);

			// If subtitles were requested but embedding failed, try fallback embedding
			if (subtitle_langs && subtitle_langs.length > 0) {
				// Check if subtitles were embedded by looking for .srt files
				const srtFiles = fs
					.readdirSync(finalDir)
					.filter((f) => f.startsWith(fileName) && f.endsWith('.srt'));

				// If SRT files exist, they weren't embedded - use fallback embedding
				if (srtFiles.length > 0) {
					const subtitlePaths = srtFiles.map((f) => path.join(finalDir, f));
					debugLog(
						`[SUBTITLE] Found ${srtFiles.length} subtitle file(s), using fallback embedding`
					);
					await embedSubtitles(actualVideoPath, subtitlePaths, multiBar, vData.title);
				} else {
					debugLog(`[SUBTITLE] Subtitles appear to be embedded by yt-dlp`);
				}
			}

			// Save video progress after successful download
			if (courseUrl && completedVideos) {
				saveVideoProgress(
					courseUrl,
					courseTitle,
					unitNumber,
					unitTitle,
					index,
					vData.title,
					'completed'
				);
				// Add to completed videos set for this session
				const videoId = getVideoId(courseUrl, unitNumber, index);
				completedVideos.add(videoId);
			}
		}

		return true;
	} catch (error) {
		const err = error as Error;
		logError(`\nDetailed error: ${err.message}`, multiBar);
		throw new Error(`Error downloading video: ${err.message}`);
	}
}
