import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type * as cliProgress from 'cli-progress';
import { checkVideoFileExists, getVideoId, saveVideoProgress } from '../csv/progress';
import { embedSubtitles } from '../subtitles/embed';
import type { VideoData } from '../types';
import { debugLog, log, logError } from '../utils/debug';
import { getDownloadPath, getN3u8DLPath } from '../utils/paths';
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

	const baseDownloadPath = getDownloadPath();
	const finalDir = path.normalize(
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

		const fileName = `${courseTitle} - U${unitNumber} - ${index}_${vData.title.trimEnd()}`;

		let downloadSuccess = false;
		const N_M3U8DL_RE = getN3u8DLPath();

		try {
			// Try first with 1080p
			const args1080p = [
				'-sv',
				'res=1920x1080',
				vData.playbackURL,
				'--save-dir',
				finalDir,
				'--save-name',
				fileName,
				'--tmp-dir',
				'.tmp',
				'--log-level',
				'INFO', // Keep INFO to get progress output for parsing
			];

			await executeWithProgress(N_M3U8DL_RE, args1080p, vData.title, multiBar);
			downloadSuccess = true;
		} catch (_error) {
			// If 1080p fails, try with best
			const argsBest = [
				'-sv',
				'for=best',
				vData.playbackURL,
				'--save-dir',
				finalDir,
				'--save-name',
				fileName,
				'--tmp-dir',
				'.tmp',
				'--log-level',
				'INFO', // Keep INFO to get progress output for parsing
			];

			await executeWithProgress(N_M3U8DL_RE, argsBest, vData.title, multiBar);
			downloadSuccess = true;
		}

		if (downloadSuccess) {
			if (subtitle_langs && subtitle_langs.length > 0) {
				const subtitlePaths: string[] = [];
				const subtitleResults: { lang: string; success: boolean; error?: string }[] = [];

				// Download each subtitle language
				for (const lang of subtitle_langs) {
					try {
						// Use spawn with args array to avoid command injection
						const subtitleArgs = [
							'--auto-subtitle-fix',
							'--sub-format',
							'SRT',
							'--select-subtitle',
							`lang="${lang}":for=all`,
							vData.playbackURL,
							'--save-dir',
							finalDir,
							'--save-name',
							fileName,
							'--tmp-dir',
							'.tmp',
							'--log-level',
							'ERROR', // Changed from OFF to ERROR to capture failures
						];

						debugLog(`[SUBTITLE] Downloading ${lang} subtitles for: ${vData.title}`);
						debugLog(`[SUBTITLE] Command: ${N_M3U8DL_RE} ${subtitleArgs.join(' ')}`);

						await new Promise<void>((resolve, reject) => {
							const subtitleProcess = spawn(N_M3U8DL_RE, subtitleArgs, {
								cwd: process.cwd(),
								shell: false,
							});

							let _stdout = '';
							let stderr = '';

							subtitleProcess.stdout.on('data', (data: Buffer) => {
								_stdout += data.toString();
							});

							subtitleProcess.stderr.on('data', (data: Buffer) => {
								stderr += data.toString();
							});

							subtitleProcess.on('close', (code: number | null) => {
								if (code === 0) {
									resolve();
								} else {
									reject(
										new Error(
											`N_m3u8DL-RE exited with code ${code}. stderr: ${stderr || 'No error output'}`
										)
									);
								}
							});

							subtitleProcess.on('error', (error: Error) => {
								reject(new Error(`Failed to spawn subtitle process: ${error.message}`));
							});
						});

						// N_m3u8DL-RE might save subtitles with different naming patterns
						// Try multiple possible paths
						const possibleSubPaths = [
							path.join(finalDir, `${fileName}.${lang}.srt`),
							path.join(finalDir, `${fileName}.srt`),
							path.join(finalDir, `${fileName}_${lang}.srt`),
							path.join(finalDir, `subtitle_${lang}.srt`),
						];

						debugLog(`[SUBTITLE] Searching for ${lang} subtitle file in: ${finalDir}`);
						debugLog(`[SUBTITLE] Attempted paths: ${possibleSubPaths.join(', ')}`);

						let subPath: string | null = null;

						// First try the expected paths
						for (const possiblePath of possibleSubPaths) {
							if (fs.existsSync(possiblePath)) {
								subPath = possiblePath;
								debugLog(`[SUBTITLE] Found ${lang} subtitle at: ${subPath}`);
								break;
							}
						}

						// If not found, search for any .srt file with the language code in the directory
						if (!subPath) {
							const files = fs.readdirSync(finalDir);
							debugLog(`[SUBTITLE] Directory contains ${files.length} files`);
							const srtFiles = files.filter(
								(f) =>
									f.endsWith('.srt') &&
									(f.includes(`.${lang}.`) || f.includes(`_${lang}.`) || f.includes(`-${lang}.`))
							);
							if (srtFiles.length > 0) {
								subPath = path.join(finalDir, srtFiles[0]);
								debugLog(`[SUBTITLE] Found ${lang} subtitle via search: ${subPath}`);
							} else {
								debugLog(
									`[SUBTITLE] No ${lang} subtitle files found. Available .srt files: ${files.filter((f) => f.endsWith('.srt')).join(', ') || 'none'}`
								);
							}
						}

						if (subPath) {
							subtitlePaths.push(subPath);
							subtitleResults.push({ lang, success: true });
						} else {
							subtitleResults.push({
								lang,
								success: false,
								error: 'Subtitle file not found after download',
							});
							log(`⚠️  ${lang.toUpperCase()} subtitles downloaded but file not found`, multiBar);
						}
					} catch (error) {
						const err = error as Error;
						subtitleResults.push({ lang, success: false, error: err.message });
						log(`⚠️  Failed to download ${lang.toUpperCase()} subtitles: ${err.message}`, multiBar);
						debugLog(`[SUBTITLE] Error details for ${lang}: ${err.stack}`);
					}
				}

				// Log summary of subtitle download results
				const successful = subtitleResults.filter((r) => r.success).length;
				const failed = subtitleResults.filter((r) => !r.success);
				if (successful > 0) {
					log(
						`✅ Successfully downloaded ${successful} subtitle language(s) for ${vData.title}`,
						multiBar
					);
				}
				if (failed.length > 0) {
					log(
						`⚠️  Failed to download ${failed.length} subtitle language(s): ${failed.map((f) => f.lang).join(', ')}`,
						multiBar
					);
				}

				// Embed all subtitles if any were found
				if (subtitlePaths.length > 0) {
					const videoPath = path.join(finalDir, `${fileName}.mp4`);

					// Verify video file exists
					let actualVideoPath: string | null = null;
					if (fs.existsSync(videoPath)) {
						actualVideoPath = videoPath;
					} else {
						// Try to find the actual video file (might have different extension)
						const videoFiles = fs
							.readdirSync(finalDir)
							.filter(
								(f) =>
									f.startsWith(fileName) &&
									(f.endsWith('.mp4') || f.endsWith('.m3u8') || f.endsWith('.ts'))
							);
						if (videoFiles.length > 0) {
							actualVideoPath = path.join(finalDir, videoFiles[0]);
						}
					}

					if (actualVideoPath) {
						// Wait for file to be fully written before embedding subtitles
						await waitForFileComplete(actualVideoPath);
						await embedSubtitles(actualVideoPath, subtitlePaths, multiBar, vData.title);
					}
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
