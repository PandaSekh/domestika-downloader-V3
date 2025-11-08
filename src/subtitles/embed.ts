import { exec as execCallback } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import type * as cliProgress from 'cli-progress';
import { debugLog, log, logError } from '../utils/debug';
import { getLanguageCode } from './language';

const exec = promisify(execCallback);

export async function embedSubtitles(
	videoPath: string,
	subtitlePaths: string[],
	multiBar?: cliProgress.MultiBar,
	videoTitle?: string
): Promise<boolean> {
	try {
		// Verify files exist
		if (!fs.existsSync(videoPath)) {
			logError(`Error: Video file not found: ${videoPath}`, multiBar);
			return false;
		}

		// Verify video file is not empty and has reasonable size
		const videoStats = fs.statSync(videoPath);
		if (videoStats.size === 0) {
			logError(`Error: Video file is empty: ${videoPath}`, multiBar);
			return false;
		}

		// Check if file is still being written (size changed in last second)
		const initialSize = videoStats.size;
		await new Promise((resolve) => setTimeout(resolve, 1000));
		const checkStats = fs.statSync(videoPath);
		if (checkStats.size !== initialSize) {
			log('Warning: Video file appears to still be writing. Waiting a bit longer...', multiBar);
			await new Promise((resolve) => setTimeout(resolve, 2000));
		}

		if (!subtitlePaths || subtitlePaths.length === 0) {
			logError('Error: No subtitle files provided', multiBar);
			return false;
		}

		// Validate all subtitle files exist and are valid
		const validSubtitlePaths: string[] = [];
		for (const subPath of subtitlePaths) {
			if (!fs.existsSync(subPath)) {
				log(`⚠️  Subtitle file not found: ${subPath}`, multiBar);
				continue;
			}

			// Check file size
			const stats = fs.statSync(subPath);
			if (stats.size === 0) {
				log(`⚠️  Subtitle file is empty: ${subPath}`, multiBar);
				continue;
			}

			// Validate subtitle file content
			let subtitleContent: string;
			try {
				subtitleContent = fs.readFileSync(subPath, 'utf-8');
			} catch (error) {
				const err = error as Error;
				log(`⚠️  Failed to read subtitle file ${subPath}: ${err.message}`, multiBar);
				debugLog(`[SUBTITLE] Read error: ${err.stack}`);
				continue;
			}

			if (subtitleContent.trim().length === 0) {
				log(`⚠️  Subtitle file contains only whitespace: ${subPath}`, multiBar);
				continue;
			}

			// Enhanced SRT validation (should contain sequence numbers, timestamps, and actual text)
			const hasSequenceNumbers = /\d+\s*\n/.test(subtitleContent);
			const hasTimestamps = /\d{2}:\d{2}:\d{2}[,.]\d{3}\s*--?>\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(
				subtitleContent
			);
			const hasTextContent = subtitleContent.split('\n').some((line) => {
				const trimmed = line.trim();
				// Check if line contains actual text (not just numbers or timestamps)
				return (
					trimmed.length > 0 &&
					!trimmed.match(/^\d+$/) && // Not just a number
					!trimmed.match(/^\d{2}:\d{2}:\d{2}/) && // Not just a timestamp
					!trimmed.match(/^--?>/)
				); // Not just an arrow
			});

			if (!hasSequenceNumbers || !hasTimestamps) {
				log(`⚠️  Subtitle file does not appear to be in valid SRT format: ${subPath}`, multiBar);
				debugLog(
					`[SUBTITLE] Validation failed - hasSequenceNumbers: ${hasSequenceNumbers}, hasTimestamps: ${hasTimestamps}`
				);
				continue;
			}

			if (!hasTextContent) {
				log(`⚠️  Subtitle file appears to have no actual subtitle text: ${subPath}`, multiBar);
				// Still allow it - might be intentional (empty subtitles)
			}

			debugLog(`[SUBTITLE] Validated subtitle file: ${subPath} (${stats.size} bytes)`);
			validSubtitlePaths.push(subPath);
		}

		if (validSubtitlePaths.length === 0) {
			logError('Error: No valid subtitle files found', multiBar);
			return false;
		}

		const dir = path.dirname(videoPath);
		const videoExt = path.extname(videoPath);
		const filename = path.basename(videoPath, videoExt);
		const outputPath = path.join(dir, `${filename}_with_subs${videoExt}`);

		// Escape paths properly for shell (handle spaces and special characters)
		const escapePath = (p: string): string => {
			// Use single quotes and escape any single quotes in the path
			return `'${p.replace(/'/g, "'\\''")}'`;
		};

		// Build ffmpeg command with multiple subtitle inputs
		// Format: ffmpeg -i video -i sub1 -i sub2 ... -map 0:v:0 -map 0:a:0 -map 1:s:0 -map 2:s:0 ...
		let ffmpegCommand = `ffmpeg -i ${escapePath(videoPath)}`;

		// Add all subtitle files as inputs
		for (const subPath of validSubtitlePaths) {
			ffmpegCommand += ` -i ${escapePath(subPath)}`;
		}

		// Map video and audio streams
		ffmpegCommand += ' -map 0:v:0 -map 0:a:0';

		// Map each subtitle stream and set metadata
		for (let i = 0; i < validSubtitlePaths.length; i++) {
			const subPath = validSubtitlePaths[i];
			const langCode = getLanguageCode(subPath);
			const streamIndex = i + 1; // First subtitle input is index 1 (0 is video)
			ffmpegCommand += ` -map ${streamIndex}:s:0 -c:s:${i} mov_text -metadata:s:s:${i} language=${langCode}`;
		}

		// Set first subtitle as default
		if (validSubtitlePaths.length > 0) {
			ffmpegCommand += ' -disposition:s:0 default';
		}

		// Copy video and audio without re-encoding
		ffmpegCommand += ` -c:v copy -c:a copy ${escapePath(outputPath)}`;

		debugLog('Running ffmpeg command to embed subtitles...');
		// Truncate long commands in log for readability
		const logCommand =
			ffmpegCommand.length > 200 ? `${ffmpegCommand.substring(0, 200)}...` : ffmpegCommand;
		debugLog(`Command: ${logCommand.replace(/\s+/g, ' ')}`);

		try {
			await exec(ffmpegCommand, { maxBuffer: 1024 * 1024 * 100 });
		} catch (error) {
			const err = error as Error;
			log(`⚠️  First ffmpeg attempt failed: ${err.message}`, multiBar);
			debugLog(`[FFMPEG] First command error: ${err.stack}`);
			debugLog(`[FFMPEG] Failed command: ${ffmpegCommand.substring(0, 500)}...`);

			// If the first command fails, try a simpler version
			log('Trying alternative ffmpeg method...', multiBar);
			let altCommand = `ffmpeg -i ${escapePath(videoPath)}`;
			for (const subPath of validSubtitlePaths) {
				altCommand += ` -i ${escapePath(subPath)}`;
			}
			altCommand += ` -c:v copy -c:a copy -c:s mov_text -disposition:s:0 default ${escapePath(outputPath)}`;

			try {
				await exec(altCommand, { maxBuffer: 1024 * 1024 * 100 });
				log('✅ Alternative ffmpeg method succeeded', multiBar);
			} catch (altError) {
				const altErr = altError as Error;
				logError(`❌ Alternative ffmpeg method also failed: ${altErr.message}`, multiBar);
				debugLog(`[FFMPEG] Alternative command error: ${altErr.stack}`);
				throw new Error(`Both ffmpeg attempts failed. Last error: ${altErr.message}`);
			}
		}

		// Verify output file was created
		if (!fs.existsSync(outputPath)) {
			logError(`Error: Output file was not created: ${outputPath}`, multiBar);
			return false;
		}

		// Get file sizes for verification
		const originalSize = fs.statSync(videoPath).size;
		const outputSize = fs.statSync(outputPath).size;
		debugLog(`Original size: ${originalSize} bytes, Output size: ${outputSize} bytes`);

		if (outputSize < originalSize * 0.9) {
			debugLog(
				'Warning: Output file is significantly smaller than original. This might indicate an error.'
			);
		}

		// If everything went well, replace the original file
		fs.unlinkSync(videoPath);
		fs.renameSync(outputPath, videoPath);
		const videoName = videoTitle ? ` for ${videoTitle}` : '';
		log(
			`Replaced original video with subtitled version (${validSubtitlePaths.length} track(s))${videoName}`,
			multiBar
		);

		// Delete all subtitle files after successful embedding
		for (const subPath of validSubtitlePaths) {
			if (fs.existsSync(subPath)) {
				fs.unlinkSync(subPath);
				debugLog(`Deleted subtitle file: ${subPath}`);
			}
		}

		// Also delete any other .srt files with the same base name
		const baseFilename = path.basename(videoPath, videoExt);
		try {
			const files = fs.readdirSync(dir);
			const srtFiles = files.filter((f) => f.startsWith(baseFilename) && f.endsWith('.srt'));
			for (const srtFile of srtFiles) {
				const srtFilePath = path.join(dir, srtFile);
				if (fs.existsSync(srtFilePath)) {
					fs.unlinkSync(srtFilePath);
					debugLog(`Deleted subtitle file: ${srtFilePath}`);
				}
			}
		} catch (_error) {
			// Ignore errors when cleaning up subtitle files
			debugLog('Warning: Could not clean up all subtitle files');
		}

		return true;
	} catch (error) {
		const err = error as Error;
		logError(`Error embedding subtitles: ${err.message}`, multiBar);
		if (err.message.includes('ffmpeg')) {
			logError('Make sure ffmpeg is installed and available in your PATH', multiBar);
		}
		return false;
	}
}
