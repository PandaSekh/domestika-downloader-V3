import { spawn } from 'node:child_process';
import * as cliProgress from 'cli-progress';

// Function to execute N_m3u8DL-RE with progress tracking
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
				})
			: new cliProgress.SingleBar({
					format: `  ${displayTitle.padEnd(30)} |{bar}| {percentage}% | ETA: {eta}s`,
					barCompleteChar: '\u2588',
					barIncompleteChar: '\u2591',
					hideCursor: true,
					clearOnComplete: true,
				});

		const childProcess = spawn(command, args, {
			cwd: process.cwd(),
			shell: false,
		});

		// Limit buffer sizes to prevent memory leaks (max 100KB each - more aggressive)
		const MAX_BUFFER_SIZE = 100 * 1024;
		let stdout = '';
		let stderr = '';
		let progressStarted = false;
		let lastProgress = 0;
		let buffer = '';

		const parseProgress = (output: string): boolean => {
			// Multiple patterns to catch different output formats from N_m3u8DL-RE
			// Pattern 1: "Progress: 50.0%" or "50.0%"
			// Pattern 2: "Downloaded: 50%" or "[50%]"
			// Pattern 3: "Segment 10/20" (calculate percentage)
			const patterns = [
				/(\d+\.?\d*)%/g, // Percentage pattern
				/\[(\d+\.?\d*)%\]/g, // Bracketed percentage
				/segment\s+(\d+)\/(\d+)/gi, // Segment progress
				/downloaded\s+(\d+\.?\d*)%/gi, // Downloaded percentage
			];

			for (const pattern of patterns) {
				let match: RegExpExecArray | null = pattern.exec(output);
				while (match !== null) {
					let progress = 0;

					if (match.length === 3) {
						// Segment pattern: calculate percentage
						const current = Number.parseInt(match[1], 10);
						const total = Number.parseInt(match[2], 10);
						if (total > 0) {
							progress = (current / total) * 100;
						}
					} else {
						progress = Number.parseFloat(match[1]);
					}

					if (progress > 0 && progress <= 100) {
						if (!progressStarted) {
							progressStarted = true;
							if (!multiBar) {
								progressBar.start(100, 0);
							}
						}
						const roundedProgress = Math.min(100, Math.max(0, Math.round(progress)));
						if (roundedProgress !== lastProgress) {
							if (multiBar) {
								progressBar.update(roundedProgress, { title: displayTitle.padEnd(30) });
							} else {
								progressBar.update(roundedProgress);
							}
							lastProgress = roundedProgress;
						}
						return true;
					}
					match = pattern.exec(output);
				}
			}
			return false;
		};

		const processOutput = (data: Buffer): void => {
			const output = data.toString();
			buffer += output;

			// Process line by line for better parsing
			const lines = buffer.split('\n');
			buffer = lines.pop() || ''; // Keep incomplete line in buffer

			for (const line of lines) {
				parseProgress(line);

				// Look for completion indicators
				if (
					line.includes('Download completed') ||
					line.includes('Merging') ||
					line.includes('Done') ||
					line.includes('Successfully')
				) {
					if (progressStarted) {
						if (multiBar) {
							progressBar.update(100, { title: displayTitle.padEnd(30) });
						} else {
							progressBar.update(100);
						}
					}
				}
			}
		};

		childProcess.stdout.on('data', (data: Buffer) => {
			const dataStr = data.toString();
			// Limit stdout buffer size to prevent memory leaks - keep only last portion
			stdout += dataStr;
			if (stdout.length > MAX_BUFFER_SIZE) {
				stdout = stdout.slice(-MAX_BUFFER_SIZE);
			}
			processOutput(data);
		});

		childProcess.stderr.on('data', (data: Buffer) => {
			const dataStr = data.toString();
			// Limit stderr buffer size to prevent memory leaks - keep only last portion
			stderr += dataStr;
			if (stderr.length > MAX_BUFFER_SIZE) {
				stderr = stderr.slice(-MAX_BUFFER_SIZE);
			}
			processOutput(data);
		});

		childProcess.on('close', (code: number | null) => {
			// Process remaining buffer
			if (buffer) {
				parseProgress(buffer);
			}

			if (progressStarted) {
				if (multiBar) {
					progressBar.update(100, { title: displayTitle.padEnd(30) });
					// Remove the bar from MultiBar to free memory and clear display
					multiBar.remove(progressBar);
				} else {
					progressBar.update(100);
					progressBar.stop();
				}
			}

			if (code === 0) {
				resolve({ stdout, stderr });
			} else {
				reject(new Error(`Process exited with code ${code}. ${stderr}`));
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
