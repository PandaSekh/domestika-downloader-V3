import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type * as cliProgress from 'cli-progress';
import { log, logDebug, logError, logSuccess, logWarning } from '../utils/debug';
import { getLanguageCode } from './language';

// Helper function to run spawn as a promise
function spawnPromise(
	command: string,
	args: string[]
): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const childProcess = spawn(command, args, {
			shell: false,
		});

		let stdout = '';
		let stderr = '';

		childProcess.stdout.on('data', (data: Buffer) => {
			stdout += data.toString();
		});

		childProcess.stderr.on('data', (data: Buffer) => {
			stderr += data.toString();
		});

		childProcess.on('close', (code: number | null) => {
			if (code === 0) {
				resolve({ stdout, stderr });
			} else {
				reject(new Error(`Process exited with code ${code}. ${stderr || stdout}`));
			}
		});

		childProcess.on('error', (error: Error) => {
			reject(error);
		});
	});
}

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
				logWarning(`Subtitle file not found: ${subPath}`, multiBar);
				continue;
			}

			// Check file size
			const stats = fs.statSync(subPath);
			if (stats.size === 0) {
				logWarning(`Subtitle file is empty: ${subPath}`, multiBar);
				continue;
			}

			// Validate subtitle file content
			let subtitleContent: string;
			try {
				subtitleContent = fs.readFileSync(subPath, 'utf-8');
			} catch (error) {
				const err = error as Error;
				logWarning(`Failed to read subtitle file ${subPath}: ${err.message}`, multiBar);
				logDebug(`[SUBTITLE] Read error: ${err.stack}`);
				continue;
			}

			if (subtitleContent.trim().length === 0) {
				logWarning(`Subtitle file contains only whitespace: ${subPath}`, multiBar);
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
				logWarning(`Subtitle file does not appear to be in valid SRT format: ${subPath}`, multiBar);
				logDebug(
					`[SUBTITLE] Validation failed - hasSequenceNumbers: ${hasSequenceNumbers}, hasTimestamps: ${hasTimestamps}`
				);
				continue;
			}

			if (!hasTextContent) {
				logWarning(`Subtitle file appears to have no actual subtitle text: ${subPath}`, multiBar);
				// Still allow it - might be intentional (empty subtitles)
			}

			logDebug(`[SUBTITLE] Validated subtitle file: ${subPath} (${stats.size} bytes)`);
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

		// Build ffmpeg args array with multiple subtitle inputs
		// Format: ffmpeg -i video -i sub1 -i sub2 ... -map 0:v:0 -map 0:a:0 -map 1:s:0 -map 2:s:0 ...
		const ffmpegArgs: string[] = ['-i', videoPath];

		// Add all subtitle files as inputs
		for (const subPath of validSubtitlePaths) {
			ffmpegArgs.push('-i', subPath);
		}

		// Map video and audio streams
		ffmpegArgs.push('-map', '0:v:0', '-map', '0:a:0');

		// Map each subtitle stream and set metadata
		for (let i = 0; i < validSubtitlePaths.length; i++) {
			const subPath = validSubtitlePaths[i];
			const langCode = getLanguageCode(subPath);
			const streamIndex = i + 1; // First subtitle input is index 1 (0 is video)
			ffmpegArgs.push(
				'-map',
				`${streamIndex}:s:0`,
				`-c:s:${i}`,
				'mov_text',
				`-metadata:s:s:${i}`,
				`language=${langCode}`
			);
		}

		// Set first subtitle as default
		if (validSubtitlePaths.length > 0) {
			ffmpegArgs.push('-disposition:s:0', 'default');
		}

		// Copy video and audio without re-encoding
		ffmpegArgs.push('-c:v', 'copy', '-c:a', 'copy', outputPath);

		logDebug('Running ffmpeg command to embed subtitles...');
		// Log command for debugging (reconstruct for readability)
		const logCommand = `ffmpeg ${ffmpegArgs.join(' ')}`;
		const truncatedLog =
			logCommand.length > 200 ? `${logCommand.substring(0, 200)}...` : logCommand;
		logDebug(`Command: ${truncatedLog.replace(/\s+/g, ' ')}`);

		try {
			await spawnPromise('ffmpeg', ffmpegArgs);
		} catch (error) {
			const err = error as Error;
			logWarning(`First ffmpeg attempt failed: ${err.message}`, multiBar);
			logDebug(`[FFMPEG] First command error: ${err.stack}`);
			logDebug(`[FFMPEG] Failed command: ${truncatedLog.substring(0, 500)}...`);

			// If the first command fails, try a simpler version
			log('Trying alternative ffmpeg method...', multiBar);
			const altArgs: string[] = ['-i', videoPath];
			for (const subPath of validSubtitlePaths) {
				altArgs.push('-i', subPath);
			}
			altArgs.push(
				'-c:v',
				'copy',
				'-c:a',
				'copy',
				'-c:s',
				'mov_text',
				'-disposition:s:0',
				'default',
				outputPath
			);

			try {
				await spawnPromise('ffmpeg', altArgs);
				logSuccess('Alternative ffmpeg method succeeded', multiBar);
			} catch (altError) {
				const altErr = altError as Error;
				logError(`Alternative ffmpeg method also failed: ${altErr.message}`, multiBar);
				logDebug(`[FFMPEG] Alternative command error: ${altErr.stack}`);
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
		logDebug(`Original size: ${originalSize} bytes, Output size: ${outputSize} bytes`);

		if (outputSize < originalSize * 0.9) {
			logDebug(
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
				logDebug(`Deleted subtitle file: ${subPath}`);
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
					logDebug(`Deleted subtitle file: ${srtFilePath}`);
				}
			}
		} catch (_error) {
			// Ignore errors when cleaning up subtitle files
			logDebug('Warning: Could not clean up all subtitle files');
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
