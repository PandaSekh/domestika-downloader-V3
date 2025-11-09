import { spawn } from 'node:child_process';
import * as cliProgress from 'cli-progress';

// Function to execute yt-dlp with progress tracking
export function executeWithProgress(
	command: string,
	args: string[],
	videoTitle: string,
	multiBar?: cliProgress.MultiBar
): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		// Truncate video title if too long for display
		const displayTitle = videoTitle.length > 30 ? `${videoTitle.substring(0, 27)}...` : videoTitle;

		// Use MultiBar if provided (for parallel downloads), otherwise use SingleBar
		const progressBar = multiBar
			? multiBar.create(100, 0, {
					title: displayTitle.padEnd(30),
					status: '',
				})
			: new cliProgress.SingleBar({
					format: `  ${displayTitle.padEnd(30)} |{bar}| {percentage}% | {status}`,
					barCompleteChar: '\u2588',
					barIncompleteChar: '\u2591',
					hideCursor: true,
					clearOnComplete: false, // Don't clear immediately so user can see completion
				});

		const childProcess = spawn(command, args, {
			cwd: process.cwd(),
			shell: false,
			stdio: ['ignore', 'pipe', 'pipe'], // stdin: ignore, stdout/stderr: pipe
		});

		// Limit buffer sizes to prevent memory leaks (max 500KB each)
		const MAX_BUFFER_SIZE = 500 * 1024;
		let stdout = '';
		let stderr = '';
		let progressStarted = false;
		let lastActualProgress = 0; // Track actual (non-rounded) progress to catch small increments
		let buffer = '';

		const parseProgress = (output: string): boolean => {
			// yt-dlp progress output formats:
			// [download]  15.9% of ~  66.41MiB at    4.87MiB/s ETA 00:13 (frag 8/52)
			// [download]  45.3% of 10.5MiB at 1.2MiB/s ETA 00:05
			// [download] 100% of 100.0MiB in 00:45
			// [download] Downloading item 1 of 5
			// 
			// More flexible regex patterns - match percentage anywhere in the line after [download]
			// Handle carriage returns and various spacing
			const patterns = [
				// Most common: [download]  PERCENTAGE% of ...
				/\[download\][^\d]*(\d+\.?\d*)%/i,
				// Fallback: Any percentage after [download]
				/\[download\].*?(\d+\.?\d*)%/i,
				// Last resort: Any percentage in the line (for other formats)
				/(\d+\.?\d*)%\s+of/i,
			];

			for (const pattern of patterns) {
				const match = pattern.exec(output);
				if (match?.[1]) {
					const progress = Number.parseFloat(match[1]);
					if (progress >= 0 && progress <= 100) {
						if (!progressStarted) {
							progressStarted = true;
							if (!multiBar) {
								progressBar.start(100, 0);
							}
						}
						const roundedProgress = Math.min(100, Math.max(0, Math.round(progress)));
						// Update if progress actually increased (even slightly)
						// This ensures we catch small increments that round to the same value
						if (progress > lastActualProgress) {
							if (multiBar) {
								progressBar.update(roundedProgress, { title: displayTitle.padEnd(30) });
							} else {
								progressBar.update(roundedProgress);
							}
							lastActualProgress = progress;
						}
						return true;
					}
				}
			}
			return false;
		};

		const processOutput = (data: Buffer): void => {
			const output = data.toString();
			buffer += output;

			// Handle both \n and \r\n line endings, and also handle \r for overwriting progress lines
			// Split by both \r and \n to catch all progress updates
			const parts = buffer.split(/\r\n|\r|\n/);
			buffer = parts.pop() || ''; // Keep incomplete line in buffer

			for (const part of parts) {
				const line = part.trim();
				if (!line) continue; // Skip empty lines

				// Try to parse progress from this line
				parseProgress(line);

				// Look for post-download processing indicators
				if (progressStarted) {
					let statusMessage = '';
					if (line.includes('[Merger]') || line.includes('Merging')) {
						statusMessage = 'Merging streams...';
					} else if (line.includes('[EmbedSubtitle]') || line.includes('Embedding')) {
						statusMessage = 'Embedding subtitles...';
					} else if (line.includes('[ExtractAudio]') || line.includes('Extracting')) {
						statusMessage = 'Extracting audio...';
					} else if (line.includes('[ConvertSubtitle]') || line.includes('Converting')) {
						statusMessage = 'Converting subtitles...';
					} else if (line.includes('Deleting original file')) {
						statusMessage = 'Cleaning up...';
					} else if (line.includes('[download] 100%')) {
						statusMessage = 'Download complete, processing...';
					}

					// Update progress bar with status message if we have one
					if (statusMessage) {
						if (multiBar) {
							progressBar.update(100, {
								title: displayTitle.padEnd(30),
								status: statusMessage,
							});
						} else {
							// For single bar, update with status message
							progressBar.update(100, { status: statusMessage });
						}
						lastActualProgress = 100;
					}
				}

				// Look for final completion
				if (
					line.includes('has already been downloaded') ||
					line.includes('Deleting original file') ||
					(line.includes('[download] 100%') && !line.includes('processing'))
				) {
					// Keep progress bar visible but mark as complete
					if (progressStarted) {
						if (multiBar) {
							progressBar.update(100, {
								title: displayTitle.padEnd(30),
								status: 'Complete',
							});
						} else {
							progressBar.update(100, { status: 'Complete' });
						}
					}
				}
			}
		};

		// yt-dlp outputs progress to stderr, not stdout
		if (childProcess.stderr) {
			childProcess.stderr.on('data', (data: Buffer) => {
				const dataStr = data.toString();
				// Limit stderr buffer size
				stderr += dataStr;
				if (stderr.length > MAX_BUFFER_SIZE) {
					stderr = stderr.slice(-MAX_BUFFER_SIZE);
				}
				processOutput(data);
			});
		}

		// Also check stdout (some output might go there)
		if (childProcess.stdout) {
			childProcess.stdout.on('data', (data: Buffer) => {
				const dataStr = data.toString();
				// Limit stdout buffer size
				stdout += dataStr;
				if (stdout.length > MAX_BUFFER_SIZE) {
					stdout = stdout.slice(-MAX_BUFFER_SIZE);
				}
				processOutput(data);
			});
		}

		childProcess.on('close', (code: number | null) => {
			// Process remaining buffer
			if (buffer) {
				parseProgress(buffer);
			}

			if (progressStarted) {
				// Show final status before removing
				if (multiBar) {
					progressBar.update(100, {
						title: displayTitle.padEnd(30),
						status: code === 0 ? 'Complete ✓' : 'Failed ✗',
					});
					// Wait a moment so user can see the final status
					setTimeout(() => {
						multiBar.remove(progressBar);
					}, 500);
				} else {
					progressBar.update(100, { status: code === 0 ? 'Complete ✓' : 'Failed ✗' });
					// Wait a moment before stopping so user can see completion
					setTimeout(() => {
						progressBar.stop();
					}, 1000);
				}
			}

			if (code === 0) {
				resolve({ stdout, stderr });
			} else {
				reject(new Error(`Process exited with code ${code}. ${stderr || stdout}`));
			}
		});

		childProcess.on('error', (error: Error) => {
			if (progressStarted) {
				if (multiBar) {
					multiBar.remove(progressBar);
				} else {
					progressBar.stop();
				}
			}
			reject(error);
		});
	});
}
